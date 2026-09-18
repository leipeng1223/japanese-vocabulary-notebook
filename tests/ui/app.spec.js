import { test, expect } from '@playwright/test';
const user={id:'00000000-0000-4000-8000-000000000001',email:'learner@example.test'};
const initial={id:'00000000-0000-4000-8000-000000000011',user_id:user.id,word:'証拠品',reading:'しょうこひん',meaning:'证物',example:'証拠品を提出する。',note:'',created_at:'2026-09-01T00:00:00.000Z',version:1};
async function mockCloud(page) {
  const state={rows:[{...initial}],failSave:false,conflict:false};
  await page.route('https://vocab-test.supabase.co/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
    if(method==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(url.pathname.endsWith('/token')) return json({access_token:'test-session-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user});
    if(url.pathname.endsWith('/user')) return json(user);
    if(url.pathname.endsWith('/logout')) return json({});
    if(url.pathname.endsWith('/words')) {
      if(method==='GET') return json(state.rows);
      if(state.failSave) return json({message:'模拟断网保存失败'},503);
      if(state.conflict) return json(null);
      const body=request.postDataJSON();
      if(method==='POST'){const row={...body,id:'00000000-0000-4000-8000-000000000012',version:1};state.rows.push(row);return json(row);}
      if(method==='PATCH'){Object.assign(state.rows[0],body,{version:state.rows[0].version+1});return json(state.rows[0]);}
    }
    if(url.pathname.endsWith('/delete_words_checked')) { const ids=request.postDataJSON().targets.map(t=>t.id);state.rows=state.rows.filter(row=>!ids.includes(row.id));return json(ids.length); }
    if(url.pathname.endsWith('/dictionary')) return json({query:'しょうこひん',warning:'',results:[{word:'証拠品の非常に長いテスト用語'.repeat(3),reading:'しょうこひん'.repeat(8),meaning:'这是用来验证长中文释义自动换行的测试文本。'.repeat(15),definitionEn:'Evidence '.repeat(80),partOfSpeech:'Noun'}]});
    return json({message:'unexpected test route'},404);
  });
  return state;
}
async function login(page) {
  await page.goto('/');await page.getByLabel('邮箱',{exact:true}).fill(user.email);await page.getByLabel('密码',{exact:true}).fill('test-password');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('#word-count')).toHaveText('共 1 个单词');
}
test('save failure keeps draft; success persists on reload; stale edits rejected; select/delete works',async({page})=>{
  const state=await mockCloud(page);await login(page);
  await page.locator('#add').click();await page.getByLabel('日语词',{exact:true}).fill('置物');state.failSave=true;
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#save-status')).toContainText('操作未完成');await expect(page.getByLabel('日语词',{exact:true})).toHaveValue('置物');
  state.failSave=false;await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#word-count')).toHaveText('共 2 个单词');
  await page.reload();await expect(page.locator('#word-count')).toHaveText('共 2 个单词');
  await page.locator('.edit-button').first().click();state.conflict=true;await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#save-status')).toContainText('另一台设备');await page.getByRole('button',{name:'取消',exact:true}).click();state.conflict=false;
  await page.getByLabel('全选当前结果').check();page.once('dialog',dialog=>dialog.accept());await page.locator('#delete-selected').click();await expect(page.locator('#word-count')).toHaveText('共 0 个单词');
});
for(const width of [375,768,1280]) test(`layout no overlap at ${width}px, including long dictionary results`,async({page})=>{
  await page.setViewportSize({width,height:950});await mockCloud(page);await login(page);
  const inspect=async(selector)=>page.locator(selector).evaluateAll(nodes=>nodes.map(node=>{
    const boxes=[...node.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.getBoundingClientRect());
    return boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
  }));
  expect(await inspect('.word-item, .workspace-heading, .account-bar, .selection-bar')).not.toContain(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('#lookup').click();await page.locator('#query').fill('shouko hin');await page.locator('#lookup-submit').click();await expect(page.locator('.dictionary-result')).toHaveCount(1);
  expect(await inspect('.dictionary-result, .dialog-header')).not.toContain(true);
  expect(await page.locator('#dictionary-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:`test-results/dictionary-${width}.png`});
  await page.locator('.dictionary-result').click();await expect(page.locator('#word-title')).toHaveText('新增单词');
  expect(await inspect('#word-form .actions, #word-form .dialog-header')).not.toContain(true);
  expect(await page.locator('#word-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});
