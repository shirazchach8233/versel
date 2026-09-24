#!/usr/bin/env python3
"""Import the 42,000-question CDPO PDF into the app question bank.

The importer preserves every existing record and ID. Incoming questions are
assigned deterministic IDs, mapped by question number to one of the 21 official
syllabus modules, and skipped when their normalized wording already exists.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from pypdf import PdfReader


MODULES = [
    (1, 2000, "Sociology - Module 1: Origin and Development of Sociology"),
    (2001, 4000, "Sociology - Module 2: Sociology in India"),
    (4001, 6000, "Sociology - Module 3: Globalisation and Development"),
    (6001, 8000, "Sociology - Module 4: Social Problems"),
    (8001, 10000, "Sociology - Module 5: Social Research Methods"),
    (10001, 12000, "Psychology - Module 1: Introduction to Psychology"),
    (12001, 14000, "Psychology - Module 2: Biological Basis of Behaviour"),
    (14001, 16000, "Psychology - Module 3: Sensation, Attention, Perception and Consciousness"),
    (16001, 18000, "Psychology - Module 4: Psychological Processes"),
    (18001, 20000, "Psychology - Module 5: Personality and Abnormal Behaviour"),
    (20001, 22000, "Psychology - Module 6: Social Psychology"),
    (22001, 24000, "Home Science - Module 1: Physiology and Microbiology"),
    (24001, 26000, "Home Science - Module 2: Child Development and Welfare"),
    (26001, 28000, "Home Science - Module 3: Human Nutrition and Dietetics"),
    (28001, 30000, "Home Science - Module 4: Extension Education and Communication"),
    (30001, 32000, "Home Science - Module 5: Basic Food Science"),
    (32001, 34000, "Social Work - Module 1: Concepts, Methods, Ethics and Development"),
    (34001, 36000, "Social Work - Module 2: Working with Individuals (Social Casework)"),
    (36001, 38000, "Social Work - Module 3: Working with Groups and Communities"),
    (38001, 40000, "Social Work - Module 4: Administration and Legislations"),
    (40001, 42000, "Social Work - Module 5: Social Security Schemes"),
]

MODULE_TITLES = {topic.split(": ", 1)[1] for _, _, topic in MODULES}
QUESTION_BODY_RE = re.compile(
    r"(?ms)^(?P<number>\d{1,5})\.\s+(?P<question>.*?)"
    r"^\(a\)\s+(?P<option_a>.*?)"
    r"^\(b\)\s+(?P<option_b>.*?)"
    r"^\(c\)\s+(?P<option_c>.*?)"
    r"^\(d\)\s+(?P<option_d>.*?)"
    r"^Ans:\s+\((?P<answer>[a-d])\)\s+(?P<answer_text>.*?)\s*\Z"
)


def clean_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def duplicate_key(value: str) -> str:
    """A punctuation-insensitive, Unicode-stable key for question wording."""
    value = unicodedata.normalize("NFKC", value).casefold()
    value = value.translate(str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'}))
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return clean_space(value)


def topic_for(number: int) -> str:
    for start, end, topic in MODULES:
        if start <= number <= end:
            return topic
    raise ValueError(f"Question number {number} is outside the expected 1-42000 range")


def strip_page_furniture(text: str) -> str:
    kept = []
    for raw_line in text.replace("\r", "").splitlines():
        line = raw_line.strip()
        if re.fullmatch(r"\d{1,4}", line):
            continue
        if re.match(r"^(Sociology|Psychology|Home Science|Social Work)\s+\|\s+Module \d+:", line):
            continue
        if line in {"SOCIOLOGY", "PSYCHOLOGY", "HOME SCIENCE", "SOCIAL WORK"}:
            continue
        if re.fullmatch(r"MODULE \d+", line):
            continue
        if line in MODULE_TITLES:
            continue
        if re.fullmatch(r"Q[\d,]+\s*[–—-]\s*Q?[\d,]+\s+\(2,000 questions\)", line):
            continue
        kept.append(raw_line)
    return "\n".join(kept)


def split_answer(value: str, correct_option: str) -> tuple[str, str]:
    """Separate the printed answer from its explanation.

    Some correct options are themselves matching pairs joined with an em dash,
    so splitting at the first dash would truncate thousands of valid answers.
    The PDF always repeats the complete correct option before the explanatory
    dash; use that known prefix instead.
    """
    value = clean_space(value)
    if value.startswith(correct_option):
        remainder = value[len(correct_option) :].strip()
        explanation = re.sub(r"^[—–-]\s*", "", remainder, count=1)
        return correct_option, clean_space(explanation)
    return value, ""


def parse_pdf(pdf_path: Path) -> tuple[list[dict], list[dict]]:
    reader = PdfReader(str(pdf_path))
    if len(reader.pages) != 2144:
        raise ValueError(f"Expected 2,144 PDF pages, found {len(reader.pages):,}")

    body = "\n".join(
        strip_page_furniture(page.extract_text() or "") for page in reader.pages[3:]
    )
    starts = []
    expected_number = 1
    for marker in re.finditer(r"(?m)^(\d{1,5})\.\s+", body):
        if int(marker.group(1)) == expected_number:
            starts.append(marker.start())
            expected_number += 1
            if expected_number == 42001:
                break
    if expected_number != 42001:
        raise ValueError(f"Could not find the start of question {expected_number}")

    parsed = []
    answer_mismatches = []
    for number, start in enumerate(starts, 1):
        end = starts[number] if number < 42000 else len(body)
        block = body[start:end].strip()
        match = QUESTION_BODY_RE.fullmatch(block)
        if not match:
            raise ValueError(f"Question {number} did not match the expected MCQ layout")
        options = [clean_space(match[f"option_{letter}"]) for letter in "abcd"]
        answer_index = ord(match["answer"]) - ord("a")
        answer_text, explanation = split_answer(match["answer_text"], options[answer_index])
        if duplicate_key(answer_text) != duplicate_key(options[answer_index]):
            answer_mismatches.append(
                {
                    "number": number,
                    "option": options[answer_index],
                    "printed_answer": answer_text,
                }
            )
        question_id = hashlib.sha256(f"cdpo-025-2026-pdf-q{number}".encode()).hexdigest()[:16]
        parsed.append(
            {
                "number": number,
                "record": {
                    "id": question_id,
                    "q": clean_space(match["question"]),
                    "o": options,
                    "a": answer_index,
                    "e": explanation,
                    "s": topic_for(number),
                },
            }
        )

    return parsed, answer_mismatches


def validate_record(record: dict) -> None:
    required = {"id", "q", "o", "a", "e", "s"}
    if set(record) != required:
        raise ValueError(f"Unexpected record fields for {record.get('id')}: {sorted(record)}")
    if not isinstance(record["id"], str) or not record["id"]:
        raise ValueError("Question ID must be a non-empty string")
    if not isinstance(record["q"], str) or not record["q"]:
        raise ValueError(f"Question {record['id']} has no wording")
    if not isinstance(record["o"], list) or len(record["o"]) != 4 or not all(record["o"]):
        raise ValueError(f"Question {record['id']} must have four non-empty options")
    if record["a"] not in range(4):
        raise ValueError(f"Question {record['id']} has an invalid answer index")
    if not isinstance(record["e"], str) or not isinstance(record["s"], str) or not record["s"]:
        raise ValueError(f"Question {record['id']} has invalid explanation/topic data")


def import_questions(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], dict]:
    for record in existing:
        validate_record(record)

    existing_by_key = defaultdict(list)
    existing_ids = set()
    for record in existing:
        existing_by_key[duplicate_key(record["q"])].append(record["id"])
        existing_ids.add(record["id"])

    accepted = []
    accepted_keys = set(existing_by_key)
    duplicate_existing = []
    duplicate_incoming = []
    id_collisions = []

    for item in incoming:
        record = item["record"]
        validate_record(record)
        key = duplicate_key(record["q"])
        if record["id"] in existing_ids:
            id_collisions.append(item["number"])
            continue
        if key in existing_by_key:
            duplicate_existing.append(
                {
                    "source_number": item["number"],
                    "existing_ids": existing_by_key[key],
                }
            )
            continue
        if key in accepted_keys:
            duplicate_incoming.append(item["number"])
            continue
        accepted.append(record)
        accepted_keys.add(key)

    if id_collisions:
        raise ValueError(f"Generated IDs collide with existing records: {id_collisions[:20]}")

    existing_duplicate_groups = [ids for ids in existing_by_key.values() if len(ids) > 1]
    report = {
        "source_questions": len(incoming),
        "existing_questions_before_import": len(existing),
        "existing_duplicate_wording_groups_preserved": len(existing_duplicate_groups),
        "skipped_as_duplicate_of_existing": len(duplicate_existing),
        "skipped_as_duplicate_within_pdf": len(duplicate_incoming),
        "questions_added": len(accepted),
        "questions_after_import": len(existing) + len(accepted),
        "added_by_topic": dict(sorted(Counter(q["s"] for q in accepted).items())),
        "duplicate_existing_examples": duplicate_existing[:50],
        "duplicate_pdf_question_numbers": duplicate_incoming[:200],
    }
    return existing + accepted, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("questions", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--write", action="store_true", help="Replace the question bank after validation")
    args = parser.parse_args()

    existing = json.loads(args.questions.read_text(encoding="utf-8"))
    incoming, answer_mismatches = parse_pdf(args.pdf)
    merged, report = import_questions(existing, incoming)
    report["printed_answer_mismatches"] = len(answer_mismatches)
    report["printed_answer_mismatch_examples"] = answer_mismatches[:50]

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.write:
        args.questions.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
