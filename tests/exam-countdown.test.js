const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync(require.resolve('../exam-countdown.js'),'utf8');
function clock(date){
  let now=Date.parse(date),tick,visibility;
  const elements=new Map();
  class FakeDate extends Date{static now(){return now;}}
  vm.runInNewContext(source,{Date:FakeDate,document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);},addEventListener(name,fn){visibility=fn;}},setInterval(fn,delay){assert.equal(delay,1000);tick=fn;}});
  return {get:id=>elements.get(id),advance:ms=>{now+=ms;tick();},resume:date=>{now=Date.parse(date);visibility();}};
}
test('countdown splits remaining time into days, hours, minutes and seconds in India time',()=>{
  const c=clock('2026-11-22T12:34:56+05:30');
  for(const [id,value] of [['exam-days','16'],['exam-hours','18'],['exam-minutes','25'],['exam-seconds','04']])assert.equal(c.get(id).textContent,value);
  c.advance(1000);assert.equal(c.get('exam-seconds').textContent,'03');
});
test('countdown handles minute rollover and catches up after a sleeping tab',()=>{
  const c=clock('2026-12-09T06:58:59+05:30');
  c.advance(1000);
  assert.equal(c.get('exam-minutes').textContent,'01');assert.equal(c.get('exam-seconds').textContent,'00');
  c.resume('2026-12-09T06:59:59+05:30');
  assert.equal(c.get('exam-minutes').textContent,'00');assert.equal(c.get('exam-seconds').textContent,'01');
});
test('7 AM IST replaces the clock with its message and the banner hides the following day',()=>{
  const c=clock('2026-12-09T06:59:59+05:30');
  c.advance(1000);
  assert.equal(c.get('exam-clock').hidden,true);
  assert.equal(c.get('exam-countdown-heading').textContent,'Your CDPO exam is today!');
  assert.equal(c.get('exam-countdown').hidden,false);
  c.resume('2026-12-10T00:00:00+05:30');assert.equal(c.get('exam-countdown').hidden,true);
});

test('the clock continues past midnight until the 7 AM exam start',()=>{
  const c=clock('2026-12-09T00:00:00+05:30');
  assert.equal(c.get('exam-clock').hidden,false);
  assert.equal(c.get('exam-hours').textContent,'07');
  assert.equal(c.get('exam-countdown-heading').textContent,'Your CDPO exam starts today at 7:00 AM IST!');
});
