#!/usr/bin/env python3
"""Stream a completed official SEMAS CSV ZIP into auditable GS25 candidates.

Python 3.10+; standard library only. No network, archive extraction, or source
modification. The output is a name/industry-based candidate inventory, NOT an
official GS25 store list. See README.md for methodology and invocation.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter, defaultdict
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import tempfile
import unicodedata
from urllib.parse import urlparse
import zipfile
import zlib


VERSION = "semas-gs25-candidates/1"
REQUIRED_COLUMNS = (
    "상가업소번호", "상호명", "지점명",
    "상권업종대분류코드", "상권업종대분류명",
    "상권업종중분류코드", "상권업종중분류명",
    "상권업종소분류코드", "상권업종소분류명",
    "시도명", "시군구명", "지번주소", "도로명주소", "경도", "위도",
)
BRANDS = ("GS25", "지에스25", "지에스이십오")
EXCLUDED_BRANDS = (
    "GSTHEFRESH", "GS더프레시", "GS더프레쉬", "지에스더프레시", "지에스더프레쉬",
    "GS슈퍼", "GS수퍼", "GSSUPER", "지에스슈퍼", "지에스수퍼",
)
KOREA_BOUNDS = {"longitude": [124.0, 132.0], "latitude": [33.0, 39.5]}


class SourceError(ValueError):
    """An input cannot be interpreted without silently losing source data."""


def member_metadata(entry: zipfile.ZipInfo) -> dict:
    """Resolve the standard Unicode Path extra field independently of Python.

    Python 3.14 resolves this field automatically; older supported versions do
    not. orig_filename still preserves the central-directory name in either.
    Never guess a legacy encoding such as CP949 or extract the member path.
    """
    utf8 = bool(entry.flag_bits & 0x800)
    raw_name = entry.orig_filename.encode("utf-8" if utf8 else "cp437")
    name = entry.orig_filename
    decoding = "utf-8-flagged" if utf8 else "cp437-unflagged"
    extra = entry.extra
    cursor = 0
    while cursor + 4 <= len(extra):
        tag, size = struct.unpack_from("<HH", extra, cursor)
        cursor += 4
        data = extra[cursor:cursor + size]
        cursor += size
        if len(data) != size:
            raise SourceError("Truncated ZIP extra field")
        if not utf8 and tag == 0x7075 and len(data) >= 5:
            version, expected_crc = struct.unpack_from("<BI", data)
            if version == 1 and expected_crc == zlib.crc32(raw_name):
                unicode_name = data[5:].decode("utf-8", errors="strict")
                if unicode_name:
                    name, decoding = unicode_name, "utf-8-unicode-path-extra-crc-verified"
    return {"name": name, "filename_decoding": decoding, "raw_filename_hex": raw_name.hex()}


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).upper().split())


def compact(value: str) -> str:
    return re.sub(r"[\W_]+", "", normalized(value), flags=re.UNICODE)


def business_name(value: str) -> str:
    # Strip only recognized legal prefixes, never arbitrary leading words.
    value = normalized(value)
    value = re.sub(r"^(?:(?:\(\s*[주유]\s*\)|주식회사|유한책임회사|유한회사)\s*)+", "", value)
    return compact(value)


def classify(row: dict[str, str]) -> dict | None:
    """Return strict/review/excluded evidence; None means no brand signal.

    Strict requires a recognized name prefix, no following numeric collision,
    and an exact convenience-store small-industry label. Review retains suffix,
    branch-only, numeric-collision, and weak convenience-industry brand matches.
    """
    name = business_name(row.get("상호명", ""))
    branch = compact(row.get("지점명", ""))
    small_industry = compact(row.get("상권업종소분류명", ""))
    convenience = small_industry in {"편의점", "체인화편의점"}
    for marker in EXCLUDED_BRANDS:
        if marker in name or marker in branch:
            return {"classification": "excluded", "reason": "non_target_gs_supermarket_brand", "marker": marker}
    matches = [(field, marker, text.find(marker))
               for field, text in (("상호명", name), ("지점명", branch))
               for marker in BRANDS if marker in text]
    if not matches:
        if convenience and (name.startswith("GS") or name.startswith("지에스")):
            return {"classification": "review", "strength": "ambiguous", "reasons": ["weak_gs_name_without_25"],
                    "name_normalized": name, "industry_convenience": True, "matches": []}
        return None
    reasons = []
    strong = False
    for field, marker, offset in matches:
        text = name if field == "상호명" else branch
        tail = text[offset + len(marker):]
        numeric_collision = bool(tail and tail[0].isdigit())
        if field == "상호명" and offset == 0 and not numeric_collision:
            strong = True
        if numeric_collision:
            reasons.append("brand_followed_by_extra_digit")
    if not strong:
        reasons.append("brand_not_unambiguous_name_prefix")
    if not convenience:
        reasons.append("small_industry_not_convenience_store")
    standard = compact(row.get("표준산업분류명", ""))
    industry_conflict = convenience and standard in {"슈퍼마켓", "대형마트", "백화점"}
    if industry_conflict:
        reasons.append("conflicting_standard_industry")
    strict = strong and convenience and not industry_conflict and not reasons
    return {"classification": "strict" if strict else "review",
            "strength": "high" if strict else "ambiguous",
            "reasons": sorted(set(reasons)) if reasons else ["recognized_name_and_convenience_industry"],
            "name_normalized": name, "industry_convenience": convenience,
            "matches": [{"field": field, "variant": marker, "offset": offset} for field, marker, offset in matches]}


def coordinates(row: dict[str, str]) -> dict:
    result = {"longitude": None, "latitude": None, "valid": False,
              "within_expected_korea_bounds": False, "issues": []}
    for axis, column, low, high in (("longitude", "경도", -180, 180), ("latitude", "위도", -90, 90)):
        text = row.get(column, "").strip()
        if not text:
            result["issues"].append(f"missing_{axis}")
            continue
        try:
            value = float(text)
        except ValueError:
            result["issues"].append(f"non_numeric_{axis}")
            continue
        if not math.isfinite(value) or not low <= value <= high:
            result["issues"].append(f"invalid_{axis}")
            continue
        result[axis] = value
    result["valid"] = result["longitude"] is not None and result["latitude"] is not None
    if result["valid"]:
        result["within_expected_korea_bounds"] = all(
            KOREA_BOUNDS[axis][0] <= result[axis] <= KOREA_BOUNDS[axis][1]
            for axis in ("longitude", "latitude"))
        if not result["within_expected_korea_bounds"]:
            result["issues"].append("outside_expected_korea_bounds")
    return result


def coordinate_bucket(value: dict) -> str:
    if any(issue.startswith("missing_") for issue in value["issues"]):
        return "missing"
    if not value["valid"]:
        return "invalid"
    return "valid_in_expected_bounds" if value["within_expected_korea_bounds"] else "valid_outside_expected_bounds"


def address_key(row: dict[str, str]) -> str | None:
    for field, prefix in (("도로명주소", "road"), ("지번주소", "land")):
        value = normalized(row.get(field, ""))
        if value:
            return f"{prefix}:{value}"
    return None


def validate_header(header: list[str], member: str) -> None:
    duplicates = [key for key, count in Counter(header).items() if count > 1]
    missing = sorted(set(REQUIRED_COLUMNS) - set(header))
    if missing or duplicates or "" in header:
        raise SourceError(f"{member}: invalid CSV schema; missing={missing}; duplicate={duplicates}; empty_header={'' in header}")


def duplicate_summary(counts: Counter) -> dict:
    groups = {key: count for key, count in sorted(counts.items()) if count > 1}
    return {"groups": len(groups), "records": sum(groups.values()),
            "extra_records": sum(count - 1 for count in groups.values()), "values": groups}


def dump_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def analyze(source_zip: Path | str, output_dir: Path | str, *, snapshot_date: str, source_url: str,
            snapshot_label: str = "") -> dict:
    """Write two new files; reject existing outputs and incomplete downloads.

    Candidates are spooled on disk so the national source archive and candidate
    rows are never loaded as one in-memory list. Duplicate counters cover only
    the extracted candidates and never merge or discard records.
    """
    source_zip = Path(source_zip).expanduser().resolve(strict=True)
    if source_zip.suffix.lower() != ".zip" or not source_zip.is_file():
        raise SourceError("Input must be a completed .zip file; partial downloads are not accepted")
    if date.fromisoformat(snapshot_date).isoformat() != snapshot_date:
        raise SourceError("snapshot_date must be YYYY-MM-DD from the source metadata")
    parsed = urlparse(source_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise SourceError("source_url must be a public HTTP(S) source metadata URL without credentials")
    output_dir = Path(output_dir).expanduser().resolve()
    candidates_path = output_dir / "gs25-candidates.jsonl"
    summary_path = output_dir / "gs25-summary.json"
    for target in (candidates_path, summary_path):
        if target.exists() or target.is_symlink():
            raise SourceError(f"Refusing to overwrite existing output: {target.name}")
    digest = hashlib.sha256()
    original_stat = source_zip.stat()
    with source_zip.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    provenance = {"archive_name": source_zip.name, "archive_sha256": digest.hexdigest(),
                  "archive_size_bytes": original_stat.st_size, "snapshot_date": snapshot_date,
                  "snapshot_label": snapshot_label, "source_url": source_url}
    summary = {"schema_version": VERSION, "source": provenance,
               "caveat": "Name/industry-derived candidates, not a complete or official GS25 store roster; no records deduplicated.",
               "classification_policy": {
                   "strict": "Recognized GS25 name prefix + exact convenience-store small-industry label, without conflicts.",
                   "review": "Ambiguous brand placement/spelling/numeric collision, branch-only signal, or non-convenience/conflicting industry.",
                   "excluded": "GS THE FRESH/GS supermarket brand signals.",
                   "coordinate_bounds": KOREA_BOUNDS,
                   "coordinate_bounds_note": "Approximate screening rectangle, not a boundary or proof of store location."},
               "raw_data_rows": 0, "blank_records_skipped": 0, "strict_count": 0, "review_count": 0,
               "excluded_non_target_brand_count": 0, "non_candidate_count": 0, "members": [],
               "non_csv_members": [], "per_region": {}, "duplicates": {}, "coordinate_validity": {}}
    regions = defaultdict(lambda: Counter(raw_rows=0, strict=0, review=0, excluded_non_target_brand=0, non_candidate=0))
    ids, addresses = Counter(), Counter()
    coordinate_all, coordinate_candidates, review_reasons = Counter(), Counter(), Counter()
    missing_ids = missing_addresses = 0
    output_dir.mkdir(parents=True, exist_ok=True)
    csv.field_size_limit(10 * 1024 * 1024)
    with tempfile.TemporaryDirectory(prefix=".semas-analysis-", dir=output_dir) as temporary:
        spool_path = Path(temporary) / "candidates-spool.jsonl"
        with zipfile.ZipFile(source_zip) as archive, spool_path.open("w", encoding="utf-8", newline="\n") as spool:
            entries = sorted(((entry, member_metadata(entry)) for entry in archive.infolist() if not entry.is_dir()), key=lambda item: item[1]["name"])
            if len({metadata["name"] for _, metadata in entries}) != len(entries):
                raise SourceError("Duplicate ZIP member names cannot be attributed unambiguously")
            csv_entries = [(entry, metadata) for entry, metadata in entries if metadata["name"].lower().endswith(".csv")]
            summary["non_csv_members"] = [metadata["name"] for _, metadata in entries if not metadata["name"].lower().endswith(".csv")]
            if not csv_entries:
                raise SourceError("ZIP contains no CSV members")
            for entry, metadata in csv_entries:
                member_name = metadata["name"]
                member_summary = {**metadata, "raw_rows": 0, "blank_records_skipped": 0,
                                  "uncompressed_bytes": entry.file_size, "crc32": f"{entry.CRC:08x}"}
                with archive.open(entry) as binary, io.TextIOWrapper(binary, encoding="utf-8-sig", errors="strict", newline="") as stream:
                    reader = csv.reader(stream, strict=True)
                    header = next(reader, None)
                    if header is None:
                        raise SourceError(f"{member_name}: empty CSV")
                    validate_header(header, member_name)
                    member_summary["columns"] = header
                    record_number = 1
                    while True:
                        line_start = reader.line_num + 1
                        values = next(reader, None)
                        if values is None:
                            break
                        record_number += 1
                        if not values:
                            summary["blank_records_skipped"] += 1
                            member_summary["blank_records_skipped"] += 1
                            continue
                        if len(values) != len(header):
                            raise SourceError(f"{member_name}: CSV record {record_number}, physical line {line_start}: expected {len(header)} fields, got {len(values)}")
                        row = dict(zip(header, values))
                        summary["raw_data_rows"] += 1
                        member_summary["raw_rows"] += 1
                        region = row["시도명"].strip() or "(missing)"
                        regions[region]["raw_rows"] += 1
                        point = coordinates(row)
                        coordinate_all[coordinate_bucket(point)] += 1
                        match = classify(row)
                        if match is None:
                            summary["non_candidate_count"] += 1
                            regions[region]["non_candidate"] += 1
                            continue
                        if match["classification"] == "excluded":
                            summary["excluded_non_target_brand_count"] += 1
                            regions[region]["excluded_non_target_brand"] += 1
                            continue
                        level = match["classification"]
                        summary[f"{level}_count"] += 1
                        regions[region][level] += 1
                        coordinate_candidates[coordinate_bucket(point)] += 1
                        if level == "review":
                            review_reasons.update(match["reasons"])
                        shop_id = row["상가업소번호"].strip()
                        key = address_key(row)
                        if shop_id:
                            ids[shop_id] += 1
                        else:
                            missing_ids += 1
                        if key:
                            addresses[key] += 1
                        else:
                            missing_addresses += 1
                        candidate = {
                            "schema_version": VERSION, "classification": level, "match": match,
                            "shop_id": row["상가업소번호"], "name": row["상호명"], "branch": row["지점명"],
                            "address": {"road": row["도로명주소"], "land": row["지번주소"]},
                            "region": {field: row.get(field, "") for field in ("시도명", "시군구명", "행정동명", "법정동명")},
                            "coordinates": point,
                            "industry": {field: value for field, value in row.items() if field.startswith(("상권업종", "표준산업"))},
                            "source": {**provenance, "zip_member": member_name,
                                       "zip_member_raw_filename_hex": metadata["raw_filename_hex"],
                                       "zip_member_filename_decoding": member_summary["filename_decoding"], "csv_record_number": record_number,
                                       "physical_line_start": line_start, "physical_line_end": reader.line_num},
                            "raw_source": row,
                        }
                        spool.write(dump_json(candidate) + "\n")
                summary["members"].append(member_summary)
        changed_stat = source_zip.stat()
        if (original_stat.st_size, original_stat.st_mtime_ns) != (changed_stat.st_size, changed_stat.st_mtime_ns):
            raise SourceError("Source ZIP changed during analysis; outputs were not published")
        summary["candidate_count"] = summary["strict_count"] + summary["review_count"]
        summary["per_region"] = {region: dict(counts) for region, counts in sorted(regions.items())}
        summary["review_reasons"] = dict(sorted(review_reasons.items()))
        summary["duplicates"] = {"scope": "extracted_candidates_only", "shop_id": duplicate_summary(ids),
                                 "address": duplicate_summary(addresses), "missing_shop_id": missing_ids,
                                 "missing_address": missing_addresses,
                                 "address_policy": "Exact NFKC/whitespace-normalized road address, or land address when road is absent; same-building stores may be distinct."}
        buckets = ("missing", "invalid", "valid_in_expected_bounds", "valid_outside_expected_bounds")
        summary["coordinate_validity"] = {"all_raw_rows": {key: coordinate_all[key] for key in buckets},
                                          "candidates": {key: coordinate_candidates[key] for key in buckets}}
        staged_candidates = Path(temporary) / "gs25-candidates.jsonl"
        with spool_path.open(encoding="utf-8") as spool, staged_candidates.open("w", encoding="utf-8", newline="\n") as target:
            for line in spool:
                candidate = json.loads(line)
                shop_id = candidate["shop_id"].strip()
                key = address_key(candidate["raw_source"])
                candidate["duplicate_flags"] = {
                    "shop_id": bool(shop_id and ids[shop_id] > 1), "shop_id_occurrences": ids[shop_id] if shop_id else 0,
                    "address": bool(key and addresses[key] > 1), "address_occurrences": addresses[key] if key else 0,
                    "address_key": key, "scope": "extracted_candidates_only"}
                target.write(dump_json(candidate) + "\n")
        staged_summary = Path(temporary) / "gs25-summary.json"
        staged_summary.write_text(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        # Exclusive destination creation refuses even a file created during the analysis.
        published = []
        try:
            for staged, final in ((staged_candidates, candidates_path), (staged_summary, summary_path)):
                with final.open("xb") as target, staged.open("rb") as source:
                    published.append(final)
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        target.write(block)
        except BaseException:
            for path in published:
                path.unlink(missing_ok=True)
            raise
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_zip", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--snapshot-date", required=True, help="Official source snapshot date, YYYY-MM-DD; not analysis date")
    parser.add_argument("--snapshot-label", default="", help="Optional verbatim release label")
    parser.add_argument("--source-url", required=True, help="Official public source metadata/download page")
    args = parser.parse_args(argv)
    try:
        summary = analyze(args.source_zip, args.output_dir, snapshot_date=args.snapshot_date,
                          source_url=args.source_url, snapshot_label=args.snapshot_label)
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile, UnicodeError) as error:
        parser.exit(2, f"Analysis failed: {error}\n")
    print(dump_json({key: summary[key] for key in ("raw_data_rows", "strict_count", "review_count", "candidate_count")}))
    print("Outputs are candidates, not an official or complete GS25 store roster.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
