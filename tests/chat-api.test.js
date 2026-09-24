const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const chatHandler=require('../api/chat');

function response(){
  return {
    statusCode:200,
    payload:null,
    status(code){this.statusCode=code;return this;},
    json(payload){this.payload=payload;return this;}
  };
}

test('study chat uses the supported NVIDIA model and returns its reply',async()=>{
  const originalFetch=global.fetch;
  const originalKey=process.env.NVIDIA_API_KEY;
  const originalModel=process.env.NVIDIA_CHAT_MODEL;
  let requestBody;
  process.env.NVIDIA_API_KEY='test-key';
  delete process.env.NVIDIA_CHAT_MODEL;
  global.fetch=async(_url,options)=>{
    requestBody=JSON.parse(options.body);
    return {ok:true,json:async()=>({choices:[{message:{content:'Study reply'}}]})};
  };

  try{
    const res=response();
    await chatHandler({method:'POST',body:{
      question:'Sample question?',options:['A','B','C','D'],correctAnswer:0,
      explanation:'Because A.',topic:'Sample',isAnswered:true,messages:[]
    }},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.payload.reply,'Study reply');
    assert.equal(requestBody.model,'deepseek-ai/deepseek-v4.1-flash');
  }finally{
    global.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY=originalKey;
    if(originalModel===undefined) delete process.env.NVIDIA_CHAT_MODEL;
    else process.env.NVIDIA_CHAT_MODEL=originalModel;
  }
});

test('study chat UI uses provider-neutral labels',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(html,/Ask AI about this/);
  assert.match(html,/>💬 Ask AI</);
  assert.doesNotMatch(html,/Ask (?:Gemini|Claude)/);
  assert.doesNotMatch(html,/connect to Claude/);
});
