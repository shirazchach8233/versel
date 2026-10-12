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
  return {fetch:global.fetch,openRouterKey:process.env.OPENROUTER_API_KEY,openRouterModel:process.env.OPENROUTER_MODEL,openAIKey:process.env.OPENAI_API_KEY,openAIModel:process.env.OPENAI_CHAT_MODEL,nvidiaKey:process.env.NVIDIA_API_KEY,nvidiaModel:process.env.NVIDIA_CHAT_MODEL};
}

function restoreEnvironment(original){
  global.fetch=original.fetch;
  for(const [name,value] of [['OPENROUTER_API_KEY',original.openRouterKey],['OPENROUTER_MODEL',original.openRouterModel],['OPENAI_API_KEY',original.openAIKey],['OPENAI_CHAT_MODEL',original.openAIModel],['NVIDIA_API_KEY',original.nvidiaKey],['NVIDIA_CHAT_MODEL',original.nvidiaModel]]){
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
    assert.equal(body.max_output_tokens,1000);
  }finally{restoreEnvironment(original);}
});

test('study chat uses the configured free OpenRouter model first',async()=>{
  const original=preserveEnvironment();
  process.env.OPENROUTER_API_KEY='openrouter-test-key';delete process.env.OPENAI_API_KEY;delete process.env.NVIDIA_API_KEY;
  let url,body;
  global.fetch=async(requestUrl,options)=>{url=requestUrl;body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'Free model reply'}}]})};};
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,200);assert.equal(res.payload.reply,'Free model reply');assert.equal(res.payload.provider,'openrouter');
    assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(body.model,'google/gemma-4-26b-a4b-it:free');assert.equal(body.max_tokens,900);
  }finally{restoreEnvironment(original);}
});

test('study chat retries OpenRouter through its free-model router after a rate limit',async()=>{
  const original=preserveEnvironment();
  process.env.OPENROUTER_API_KEY='openrouter-test-key';delete process.env.OPENROUTER_MODEL;delete process.env.OPENAI_API_KEY;delete process.env.NVIDIA_API_KEY;
  const models=[];
  global.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);models.push(body.model);
    if(models.length===1)return {ok:false,status:429,text:async()=>'{"error":"rate limited"}'};
    return {ok:true,json:async()=>({choices:[{message:{content:'Routed free model reply'}}]})};
  };
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,200);assert.equal(res.payload.reply,'Routed free model reply');
    assert.deepEqual(models,['google/gemma-4-26b-a4b-it:free','openrouter/free']);assert.equal(res.payload.model,'openrouter/free');
  }finally{restoreEnvironment(original);}
});

test('study chat ignores an upstream safety label and tries another free route',async()=>{
  const original=preserveEnvironment();
  process.env.OPENROUTER_API_KEY='openrouter-test-key';delete process.env.OPENROUTER_MODEL;delete process.env.OPENAI_API_KEY;delete process.env.NVIDIA_API_KEY;
  const models=[];
  global.fetch=async(_url,options)=>{
    models.push(JSON.parse(options.body).model);
    const content=models.length===1?'User Safety: safe':'Useful explanation';
    return {ok:true,json:async()=>({choices:[{message:{content}}]})};
  };
  try{
    const res=response();await chatHandler(request(),res);
    assert.equal(res.statusCode,200);assert.equal(res.payload.reply,'Useful explanation');assert.equal(res.payload.model,'openrouter/free');
    assert.deepEqual(models,['google/gemma-4-26b-a4b-it:free','openrouter/free']);
  }finally{restoreEnvironment(original);}
});

test('study chat falls back to NVIDIA when OpenAI fails',async()=>{
  const original=preserveEnvironment();
  const calls=[];
  process.env.OPENAI_API_KEY='openai-test-key';process.env.NVIDIA_API_KEY='nvidia-test-key';
  global.fetch=async(url,options)=>{
    calls.push(url);
    if(url.includes('openai.com'))return {ok:false,status:429,headers:{get:()=> 'req_rate'},text:async()=> 'rate limited'};
    const body=JSON.parse(options.body);assert.equal(body.model,'nvidia/nemotron-3.5-lightning-30b-a3b');assert.equal(body.max_tokens,900);
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

test('study AI UI opens a complete explanation and uses provider-neutral labels',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(html,/✨ Explain with AI/);assert.match(html,/>✨ AI Explanation</);
  assert.match(html,/function requestStudyExplanation\(\)/);
  assert.match(html,/Explain this entire question in detail/);
  assert.match(html,/if\(!studyChatHistory\.length\) requestStudyExplanation\(\)/);
  assert.doesNotMatch(html,/Ask AI about this/);
  assert.doesNotMatch(html,/Ask (?:Gemini|Claude)/);assert.doesNotMatch(html,/connect to Claude/);
});
