"""Synthetic fixtures only: no downloads or live data needed."""

import csv
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile
import zlib

from analyze_semas import REQUIRED_COLUMNS, SourceError, analyze, classify, coordinates, member_metadata


def row(name="GS25역삼점", **changes):
    result = dict.fromkeys(REQUIRED_COLUMNS, "")
    result.update({"상가업소번호": "00001", "상호명": name, "지점명": "역삼점",
                   "상권업종소분류코드": "G20405", "상권업종소분류명": "편의점",
                   "시도명": "서울특별시", "시군구명": "강남구",
                   "도로명주소": "서울특별시 강남구 테스트로 12", "지번주소": "서울특별시 강남구 역삼동 1-2",
                   "경도": "127.03", "위도": "37.50"})
    result.update(changes)
    return result


def csv_bytes(rows, header=REQUIRED_COLUMNS, encoding="utf-8-sig"):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(header)
    writer.writerows([[record.get(key, "") for key in header] for record in rows])
    return output.getvalue().encode(encoding)


class ClassificationTests(unittest.TestCase):
    def test_nfkc_and_named_brand_variants(self):
        for name in ("ＧＳ２５역삼점", "gs 25 역삼점", "지에스25역삼점", "지에스이십오역삼점", "(주) GS25역삼점", "주식회사 지에스25"):
            with self.subTest(name=name):
                self.assertEqual(classify(row(name))["classification"], "strict")

    def test_supermarkets_are_excluded_even_with_convenience_label(self):
        for name in ("GS THE FRESH 역삼", "ＧＳ슈퍼", "지에스수퍼마켓", "GS더프레시", "GS25 GS THE FRESH"):
            with self.subTest(name=name):
                self.assertEqual(classify(row(name))["classification"], "excluded")

    def test_ambiguous_and_wrong_industry_are_reviewed_not_dropped(self):
        examples = [row("GS2500"), row("행복GS25"), row("GS편의점"),
                    row("별상점", 지점명="GS25역삼점"), row("GS25", 상권업종소분류명="슈퍼마켓"),
                    row("GS25", 표준산업분류명="슈퍼마켓")]
        for example in examples:
            with self.subTest(example=example["상호명"]):
                self.assertEqual(classify(example)["classification"], "review")
        self.assertIsNone(classify(row("CU역삼점")))
        self.assertIsNone(classify(row("GS자동차", 상권업종소분류명="자동차수리")))

    def test_coordinate_validation_no_nan_or_swapped_coordinates(self):
        self.assertTrue(coordinates(row())["valid"])
        for changes in ({"경도": "NaN"}, {"위도": "Infinity"}, {"위도": "127", "경도": "37"}, {"경도": "181"}, {"위도": ""}):
            self.assertFalse(coordinates(row(**changes))["valid"])
        self.assertTrue(coordinates(row(경도="0", 위도="0"))["valid"])
        self.assertFalse(coordinates(row(경도="0", 위도="0"))["within_expected_korea_bounds"])


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.archive = self.base / "official-synthetic.zip"

    def write_zip(self, members):
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, contents in members:
                archive.writestr(name, contents)

    def run_analysis(self, directory="output"):
        return analyze(self.archive, self.base / directory, snapshot_date="2026-06-30",
                       source_url="https://www.data.go.kr/example", snapshot_label="Synthetic test fixture")

    def test_multi_member_counts_provenance_and_all_duplicate_flags(self):
        rows = [row(), row("CU", 상가업소번호="cu"), row("GS THE FRESH", 상가업소번호="super"),
                row("GS2500", 상가업소번호="ambiguous", 경도="NaN"),
                row("GS25다른점", 상가업소번호="00001", 시도명="경기도", 도로명주소="서울특별시  강남구 테스트로 12")]
        self.write_zip([("b.csv", csv_bytes(rows[3:])), ("a.csv", csv_bytes(rows[:3])), ("README.txt", b"metadata")])
        before = self.archive.read_bytes()
        summary = self.run_analysis()
        output = self.base / "output"
        candidates = [json.loads(line) for line in (output / "gs25-candidates.jsonl").read_text().splitlines()]
        self.assertEqual(summary["raw_data_rows"], 5)
        self.assertEqual((summary["strict_count"], summary["review_count"]), (2, 1))
        self.assertEqual(summary["excluded_non_target_brand_count"], 1)
        self.assertEqual(summary["non_candidate_count"], 1)
        self.assertEqual(summary["per_region"]["경기도"]["strict"], 1)
        self.assertEqual([entry["name"] for entry in summary["members"]], ["a.csv", "b.csv"])
        self.assertEqual(summary["duplicates"]["shop_id"]["groups"], 1)
        self.assertEqual(summary["duplicates"]["shop_id"]["records"], 2)
        self.assertEqual(summary["duplicates"]["address"]["records"], 3)
        self.assertEqual(summary["coordinate_validity"]["all_raw_rows"]["invalid"], 1)
        self.assertEqual(sum(summary["coordinate_validity"]["all_raw_rows"].values()), 5)
        self.assertEqual(sum(summary["coordinate_validity"]["candidates"].values()), 3)
        self.assertEqual(candidates[0]["shop_id"], "00001")
        self.assertEqual(candidates[0]["raw_source"], rows[0])
        self.assertEqual(candidates[0]["source"]["csv_record_number"], 2)
        self.assertEqual(candidates[0]["source"]["physical_line_start"], 2)
        self.assertEqual(candidates[0]["source"]["snapshot_date"], "2026-06-30")
        self.assertEqual(candidates[0]["source"]["archive_sha256"], hashlib.sha256(before).hexdigest())
        self.assertTrue(candidates[0]["duplicate_flags"]["shop_id"])
        self.assertTrue(candidates[2]["duplicate_flags"]["shop_id"])
        self.assertEqual(self.archive.read_bytes(), before)

    def test_deterministic_output_and_refuses_overwrite(self):
        self.write_zip([("only.csv", csv_bytes([row()]))])
        self.run_analysis("first")
        self.run_analysis("second")
        for name in ("gs25-candidates.jsonl", "gs25-summary.json"):
            self.assertEqual((self.base / "first" / name).read_bytes(), (self.base / "second" / name).read_bytes())
        with self.assertRaises(SourceError):
            self.run_analysis("first")

    def test_missing_header_and_duplicate_header_fail_closed(self):
        for header in (REQUIRED_COLUMNS[:-1], REQUIRED_COLUMNS + ("상호명",)):
            with self.subTest(header=header):
                self.write_zip([("bad.csv", csv_bytes([row()], header))])
                with self.assertRaises(SourceError):
                    self.run_analysis()
                self.assertFalse((self.base / "output" / "gs25-candidates.jsonl").exists())
                self.assertFalse((self.base / "output" / "gs25-summary.json").exists())

    def test_extra_columns_and_multiline_rows_are_preserved(self):
        example = row("GS25\n역삼점", 추가필드="source-value")
        self.write_zip([("nested/seoul.csv", csv_bytes([example], REQUIRED_COLUMNS + ("추가필드",)))])
        self.run_analysis()
        candidate = json.loads((self.base / "output" / "gs25-candidates.jsonl").read_text())
        self.assertEqual(candidate["raw_source"]["추가필드"], "source-value")
        self.assertEqual(candidate["source"]["physical_line_start"], 2)
        self.assertEqual(candidate["source"]["physical_line_end"], 3)

    def test_malformed_row_or_utf8_never_publishes_partial_output(self):
        for contents in (csv_bytes([row()]) + b"too,few,fields\n", csv_bytes([row()]) + b"\xff\n"):
            self.write_zip([("bad.csv", contents)])
            with self.assertRaises((SourceError, UnicodeDecodeError)):
                self.run_analysis()
            self.assertFalse((self.base / "output" / "gs25-candidates.jsonl").exists())

    def test_empty_archive_and_incomplete_extension_rejected(self):
        self.write_zip([("README.txt", b"nothing")])
        with self.assertRaises(SourceError):
            self.run_analysis()
        partial = self.base / "synthetic.crdownload"
        partial.write_bytes(b"not an archive")
        with self.assertRaisesRegex(SourceError, "completed"):
            analyze(partial, self.base / "out", snapshot_date="2026-06-30", source_url="https://www.data.go.kr/example")

    def test_missing_identity_and_address_not_duplicate_groups(self):
        self.write_zip([("only.csv", csv_bytes([row(상가업소번호="", 도로명주소="", 지번주소="") for _ in range(2)]))])
        summary = self.run_analysis()
        self.assertEqual(summary["duplicates"]["missing_shop_id"], 2)
        self.assertEqual(summary["duplicates"]["shop_id"]["groups"], 0)
        self.assertEqual(summary["duplicates"]["address"]["groups"], 0)

    def test_unicode_path_extra_identical_before_and_after_python_decoding(self):
        entry = zipfile.ZipInfo("legacy.csv")
        name = "공식_서울.csv"
        data = struct.pack("<BI", 1, zlib.crc32(b"legacy.csv")) + name.encode("utf-8")
        entry.extra = struct.pack("<HH", 0x7075, len(data)) + data
        old_python = member_metadata(entry)
        entry.filename = name  # Mirrors Python 3.14; orig_filename stays legacy.
        self.assertEqual(member_metadata(entry), old_python)
        self.assertEqual(old_python["name"], name)
        self.assertEqual(old_python["filename_decoding"], "utf-8-unicode-path-extra-crc-verified")
        self.assertEqual(old_python["raw_filename_hex"], b"legacy.csv".hex())

    def test_unverified_unicode_path_extra_is_not_trusted(self):
        entry = zipfile.ZipInfo("legacy.csv")
        data = struct.pack("<BI", 1, 0) + "잘못된.csv".encode("utf-8")
        entry.extra = struct.pack("<HH", 0x7075, len(data)) + data
        self.assertEqual(member_metadata(entry)["name"], "legacy.csv")


if __name__ == "__main__":
    unittest.main()
