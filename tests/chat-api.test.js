const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const chatHandler=require('../api/chat');

function response(){
  return {statusCode:200,payload:null,status(code){this.statusCode=code;return this;},json(payload){this.payload=payload;return this;}};
}

const request=()=>({method:'POST',body:{
  question:'Sample question?',options:['A','B','C','D'],correctAnswer:0,
  explanation:'Because A.',topic:'Sample',isAnswered:true,
  messages:[{role:'user',content:'Please explain'}]
}});

function preserveEnvironment(){
  return {fetch:global.fetch,openAIKey:process.env.OPENAI_API_KEY,openAIModel:process.env.OPENAI_CHAT_MODEL,nvidiaKey:process.env.NVIDIA_API_KEY,nvidiaModel:process.env.NVIDIA_CHAT_MODEL};
}

function restoreEnvironment(original){
  global.fetch=original.fetch;
  for(const [name,value] of [['OPENAI_API_KEY',original.openAIKey],['OPENAI_CHAT_MODEL',original.openAIModel],['NVIDIA_API_KEY',original.nvidiaKey],['NVIDIA_CHAT_MODEL',original.nvidiaModel]]){
    if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
}

test('study chat uses OpenAI Responses API as the primary provider',async()=>{
  const original=preserveEnvironment();
  let url,body,authorization;
  process.env.OPENAI_API_KEY='openai-test-key';process.env.NVIDIA_API_KEY='nvidia-test-key';delete process.env.OPENAI_CHAT_MODEL;
  global.fetch=async(requestUrl,options)=>{
    url=requestUrl;body=JSON.parse(options.body);authorization=options.headers.authorization;
    return {ok:true,headers:{get:name=>name==='x-request-id'?'req_test':null},json:async()=>({output_text:'OpenAI reply'})};
  };
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,200);assert.deepEqual(res.payload,{reply:'OpenAI reply',provider:'openai'});
    assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(authorization,'Bearer openai-test-key');
    assert.equal(body.model,'gpt-4.1-mini');assert.equal(body.store,false);assert.equal(body.input[0].content,'Please explain');assert.match(body.instructions,/Kerala PSC/);
  }finally{restoreEnvironment(original);}
});

test('study chat falls back to NVIDIA when OpenAI fails',async()=>{
  const original=preserveEnvironment();
  const calls=[];
  process.env.OPENAI_API_KEY='openai-test-key';process.env.NVIDIA_API_KEY='nvidia-test-key';
  global.fetch=async(url,options)=>{
    calls.push(url);
    if(url.includes('openai.com'))return {ok:false,status:429,headers:{get:()=> 'req_rate'},text:async()=> 'rate limited'};
    const body=JSON.parse(options.body);assert.equal(body.model,'nvidia/nemotron-3.5-lightning-30b-a3b');
    return {ok:true,json:async()=>({choices:[{message:{content:'Fallback reply'}}]})};
  };
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,200);assert.deepEqual(res.payload,{reply:'Fallback reply',provider:'nvidia'});assert.equal(calls.length,2);
  }finally{restoreEnvironment(original);}
});

test('NVIDIA is retried once after a transient failure',async()=>{
  const original=preserveEnvironment();
  let attempts=0;
  delete process.env.OPENAI_API_KEY;process.env.NVIDIA_API_KEY='nvidia-test-key';
  global.fetch=async()=>{
    attempts++;
    if(attempts===1)throw new Error('temporary timeout');
    return {ok:true,json:async()=>({choices:[{message:{content:'Retry reply'}}]})};
  };
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,200);assert.equal(res.payload.reply,'Retry reply');assert.equal(attempts,2);
  }finally{restoreEnvironment(original);}
});

test('study chat reports a configuration error when no provider key exists',async()=>{
  const original=preserveEnvironment();
  delete process.env.OPENAI_API_KEY;delete process.env.NVIDIA_API_KEY;
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,500);assert.match(res.payload.error,/No AI provider/);
  }finally{restoreEnvironment(original);}
});

test('study chat UI uses provider-neutral labels',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(html,/Ask AI about this/);assert.match(html,/>💬 Ask AI</);
  assert.doesNotMatch(html,/Ask (?:Gemini|Claude)/);assert.doesNotMatch(html,/connect to Claude/);
});
