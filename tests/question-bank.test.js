const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const selection=require('../question-selection');

const bank=JSON.parse(fs.readFileSync(require.resolve('../questions.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(require.resolve('../reports/cdpo-question-import.json'),'utf8'));
const imported=bank.filter(question=>question.s.includes(' - Module '));

test('question bank records retain the app schema and unique IDs',()=>{
  assert.equal(bank.length,report.questions_after_import);
  assert.equal(new Set(bank.map(question=>question.id)).size,bank.length);
  for(const question of bank){
    assert.deepEqual(Object.keys(question).sort(),['a','e','id','o','q','s']);
    assert.equal(typeof question.id,'string');
    assert.equal(typeof question.q,'string');
    assert.equal(typeof question.e,'string');
    assert.equal(typeof question.s,'string');
    assert.equal(question.o.length,4);
    assert.ok(question.o.every(option=>typeof option==='string'&&option.length>0));
    assert.ok(Number.isInteger(question.a)&&question.a>=0&&question.a<4);
  }
});

test('PDF additions are unique and mapped across all 21 syllabus modules',()=>{
  assert.equal(imported.length,report.questions_added);
  assert.equal(new Set(imported.map(question=>question.s)).size,21);
  assert.equal(new Set(imported.map(selection.key)).size,imported.length);

  const importedKeys=new Set(imported.map(selection.key));
  const legacyKeys=new Set(bank.filter(question=>!question.s.includes(' - Module ')).map(selection.key));
  assert.ok([...importedKeys].every(key=>!legacyKeys.has(key)));
});

test('import report records a complete and internally consistent source audit',()=>{
  assert.equal(report.source_questions,42000);
  assert.equal(report.printed_answer_mismatches,0);
  assert.equal(
    report.questions_added+report.skipped_as_duplicate_of_existing+report.skipped_as_duplicate_within_pdf,
    report.source_questions
  );
  assert.equal(
    Object.values(report.added_by_topic).reduce((total,count)=>total+count,0),
    report.questions_added
  );
});
