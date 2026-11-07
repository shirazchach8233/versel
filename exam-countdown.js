(function(){
  'use strict';
  const dayMs=86400000;
  const examDay=Date.UTC(2026,11,9);
  const indiaOffset=330*60000;
  function updateExamCountdown(){
    const banner=document.getElementById('exam-countdown');
    if(!banner)return;
    // Compare calendar dates in India, regardless of the visitor's timezone.
    const today=new Date(Date.now()+indiaOffset);
    const days=Math.round((examDay-Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()))/dayMs);
    banner.hidden=days<0;
    if(days<0)return;
    document.getElementById('exam-days').textContent=days===0?'Today':String(days);
    document.getElementById('exam-days-label').textContent=days===0?'Exam day':days===1?'Day to go':'Days to go';
    document.getElementById('exam-countdown-heading').textContent=days===0?'Your CDPO exam is today!':'Your CDPO exam is getting closer';
    document.getElementById('exam-countdown-message').textContent=days===0?'Stay calm, trust your preparation, and give it your best. All the best!':'A little practice every day brings you closer to your goal. Keep going!';
  }
  updateExamCountdown();
  setInterval(updateExamCountdown,30000);
  document.addEventListener('visibilitychange',updateExamCountdown);
})();
