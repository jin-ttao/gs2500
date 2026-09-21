# National SEMAS candidate extraction

`analyze_semas.py` uses Python 3.10+ and the standard library. It reads a
**completed** ZIP supplied explicitly, streams every CSV using strict UTF-8 with
optional BOM, and never extracts ZIP paths or changes the source. No network
access is performed. Do not supply a `.crdownload` or infer completion from size.

Run synthetic tests without creating bytecode in the repository:

```sh
python3 -B -m unittest discover -s research/scripts -p 'test_*.py' -v
```

After the completed official ZIP and its release metadata have been confirmed:

```sh
python3 -B research/scripts/analyze_semas.py /exact/completed/source.zip \
  --output-dir /exact/new/output-directory \
  --snapshot-date YYYY-MM-DD \
  --snapshot-label 'Official release label' \
  --source-url 'https://www.data.go.kr/the-confirmed-source-page'
```

The date must describe the source snapshot, not the day the analysis ran. The
source URL must be the public metadata page, not a signed download URL containing
credentials. The analyzer requires its essential Korean headers and preserves
all additional columns. Missing/duplicate headers, malformed rows, invalid UTF-8,
and duplicate member names fail closed, without publishing incomplete outputs.
Existing outputs are never overwritten. Fix a source/schema issue explicitly;
do not silently skip a province or an unreadable file.

## Classification and limitations

- `strict`: a recognized NFKC-normalized **name prefix** (`GS25`, `지에스25`, or
  `지에스이십오`), no trailing numeric collision, and small-industry name exactly
  `편의점` or `체인화 편의점`. Known contradictory standard-industry labels move
  the record to review. Recognized legal prefixes and punctuation are normalized.
- `review`: a name containing the brand elsewhere, branch-only evidence,
  extra digits such as `GS2500`, a recognized brand under another industry, or a
  weak `GS`/`지에스` name under the convenience-store industry.
- Explicit GS THE FRESH/GS supermarket name or branch signals are counted as
  excluded, even when the industry says convenience store.
- This is a reproducible **candidate list**, not GS Retail's official store
  roster, proof of current operation, or a claim that every GS25 was identified.
  Misspellings without these signals may be missed. Review is not rejection.
  Even strict candidates need external confirmation before being called official.

## Outputs

`gs25-candidates.jsonl` preserves every candidate, including duplicate records:
original shop ID (including leading zeroes), name, branch, both addresses, region,
industry fields, original coordinates and all remaining fields in `raw_source`.
Each row includes ZIP name and SHA-256, snapshot date/label, source URL, ZIP member,
CSV record number and physical start/end lines. Coordinate quality and duplicate
flags are separate from brand classification; invalid locations are not dropped.
ZIP names use the UTF-8 flag or a CRC-verified standard Unicode Path extra field,
with original filename bytes retained as hex. The extra field is handled
explicitly for consistent names before/after Python 3.14. Without that evidence,
the ZIP-standard CP437 fallback is retained; CP949 is never guessed.

`gs25-summary.json` includes all parsed data-row counts, per-member schemas and
counts, skipped blank records, exclusions, strict/review totals, per-region
counts, coordinate validity, review reasons and duplicate groups. Duplicate
counters apply **only to extracted candidates**, not all businesses. Shop-ID
comparison trims surrounding whitespace; address comparison uses NFKC and
whitespace normalization, preferring road address and otherwise land address.
An address collision can mean separate stores in one building: nothing is merged.

Coordinate checks separate missing values, invalid numbers/world bounds, and
valid coordinates inside/outside an explicitly documented approximate Korea
rectangle. That rectangle is a screening aid, not a geographic boundary test.
Missing takes precedence when another coordinate is also malformed; individual
issues remain in each candidate. Source addresses and coordinates can be stale.

CSV entries are processed in sorted ZIP-member order and rows retain source order.
No run timestamp or absolute local path is written, so the same archive and
arguments produce byte-identical results. Candidate rows are spooled to disk;
only candidate ID/address counters, not the national dataset, are held in memory.
Outputs contain public business-source records, not customer-level data.
