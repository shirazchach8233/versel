(function(){
  'use strict';
  // Exam starts on 9 December 2026 at 7:00 AM in India.
  const examDay=Date.parse('2026-12-09T00:00:00+05:30');
  const examStart=Date.parse('2026-12-09T07:00:00+05:30');
  const examEnd=Date.parse('2026-12-10T00:00:00+05:30');
  function updateExamCountdown(){
    const banner=document.getElementById('exam-countdown');
    if(!banner)return;
    // Recompute from the clock each tick so sleeping/background tabs do not drift.
    const now=Date.now();
    banner.hidden=now>=examEnd;
    if(banner.hidden)return;
    const isExamDay=now>=examDay;
    const hasStarted=now>=examStart;
    const remaining=Math.max(0,Math.ceil((examStart-now)/1000));
    const days=Math.floor(remaining/86400);
    const hours=Math.floor(remaining%86400/3600);
    const minutes=Math.floor(remaining%3600/60);
    const seconds=remaining%60;
    document.getElementById('exam-days').textContent=String(days);
    document.getElementById('exam-days-label').textContent=days===1?'Day':'Days';
    for(const [id,value] of [['exam-hours',hours],['exam-minutes',minutes],['exam-seconds',seconds]]){
      document.getElementById(id).textContent=String(value).padStart(2,'0');
    }
    document.getElementById('exam-clock').hidden=hasStarted;
    document.getElementById('exam-countdown-heading').textContent=isExamDay?(hasStarted?'Your CDPO exam is today!':'Your CDPO exam starts today at 7:00 AM IST!'):'Your CDPO exam is getting closer';
    document.getElementById('exam-countdown-message').textContent=isExamDay?'Stay calm, trust your preparation, and give it your best. All the best!':'A little practice every day brings you closer to your goal. Keep going!';
  }
  updateExamCountdown();
  setInterval(updateExamCountdown,1000);
  document.addEventListener('visibilitychange',updateExamCountdown);
})();
