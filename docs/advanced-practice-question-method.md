# Advanced Practice Question Method

## Coverage and composition

The Advanced Practice bank contains 8,400 entries across the 21 Kerala PSC CDPO syllabus modules: 400 entries per module. The entries are stored in [`../advanced-practice.js`](../advanced-practice.js) and tagged by subject and module.

The current bank supplies all 400 entries for every module. The app has a fallback that can supplement a module from the existing syllabus bank if it has fewer than 400 Advanced Practice entries. In that case, it ranks eligible questions by a challenge score that favors application-style wording, longer stems and options, and fuller explanations, with a stable tie-break. That fallback is not needed to fill the current 21 module sets.

Correction: an earlier conversational summary described the current sets as a hybrid of authored and existing questions. The repository data and checks show that the current Advanced Practice sets have 400 entries in the dedicated Advanced Practice bank for each module; the existing-bank fallback is conditional.

## Question format

Each entry is written for a specific module and uses an application-oriented or case-style question pattern. Entries include:

- Six distinct answer choices and an answer index.
- A hint intended to guide reasoning before revealing the answer.
- An explanation for the correct answer.
- An HTTPS source reference for further reading.

Distractors are designed to be plausible and conceptually close, so learners must distinguish between related ideas rather than rely only on recall. Advanced Practice questions appear before any fallback questions when a module is opened.

## Automated checks

The checks in [`../tests/question-selection.test.js`](../tests/question-selection.test.js) cover the bank and module assembly. They assert 8,400 total entries, 400 per syllabus module, unique IDs and normalized question wording, no wording overlap with the existing bank, six distinct choices, a valid answer index, non-empty hints and explanations, HTTPS sources, and an application-question minimum when fallback questions are needed.

These checks validate structure, coverage, and selection rules. They do not replace subject-matter review of every factual claim or source; reviewers should confirm those before relying on a question for exam preparation.

