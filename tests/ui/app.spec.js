import { test, expect } from '@playwright/test';
const user={id:'00000000-0000-4000-8000-000000000001',email:'learner@example.test'};
const initial={id:'00000000-0000-4000-8000-000000000011',user_id:user.id,word:'証拠品',reading:'しょうこひん',meaning:'证物',example:'証拠品を提出する。',note:'',created_at:'2026-09-01T00:00:00.000Z',version:1};
async function mockCloud(page) {
  const state={rows:[{...initial,source:'逆转裁判'}],sources:['逆转裁判'],groups:[],failSave:false,conflict:false};
  await page.route('https://vocab-test.supabase.co/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
    if(method==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(url.pathname.endsWith('/token')) return json({access_token:'test-session-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user});
    if(url.pathname.endsWith('/user')) return json(user);
    if(url.pathname.endsWith('/logout')) return json({});
    if(url.pathname.endsWith('/confusion_groups')) {
      if(method==='GET')return json(state.groups);
      const index=state.groups.findIndex(g=>`eq.${g.id}`===url.searchParams.get('id'));
      const removed=state.groups.splice(index,1);return json(removed.map(g=>({id:g.id})));
    }
    if(url.pathname.endsWith('/save_confusion_group')) {
      if(state.failSave)return json({message:'模拟保存失败'},503);
      const body=request.postDataJSON(),previous=state.groups.find(g=>g.id===body.target);
      if(previous&&previous.version!==body.expected_version)return json({message:'分组已修改'},409);
      const group={id:body.target||'group-1',title:body.group_title,note:body.group_note,version:(previous?.version||0)+1,confusion_group_words:body.word_ids.map((word_id,position)=>({word_id,position}))};
      state.groups=state.groups.filter(g=>g.id!==group.id);state.groups.push(group);return json(group.id);
    }
    if(url.pathname.endsWith('/word_sources')) {
      if(method==='GET') return json(state.sources.map(name=>({name})));
      const {name}=request.postDataJSON();state.sources.push(name);return json(null,201);
    }
    if(url.pathname.endsWith('/words')) {
      if(method==='GET') return json(state.rows);
      if(state.failSave) return json({message:'模拟断网保存失败'},503);
      if(state.conflict) return json(null);
      const body=request.postDataJSON();
      if(method==='POST'){const row={...body,id:'00000000-0000-4000-8000-000000000012',version:1};state.rows.push(row);return json(row);}
      if(method==='PATCH'){const row=state.rows.find(row=>`eq.${row.id}`===url.searchParams.get('id'));Object.assign(row,body,{version:row.version+1});return json(row);}
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
test('sources persist, filter words and review, and receive new dictionary words',async({page})=>{
  const state=await mockCloud(page);await login(page);
  await page.locator('#add-source').click();await page.getByLabel('来源名称',{exact:true}).fill('日常生活');await page.locator('#save-source').click();
  await expect(page.locator('#word-count')).toHaveText('共 0 个单词');
  await page.locator('#lookup').click();await page.locator('#query').fill('test');await page.locator('#lookup-submit').click();await page.locator('.dictionary-result').click();
  await expect(page.getByLabel('来源',{exact:true})).toHaveValue('日常生活');
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#word-count')).toHaveText('共 1 个单词');
  expect(state.rows[1].source).toBe('日常生活');
  await page.locator('#source-tabs').getByRole('button',{name:'逆转裁判',exact:true}).click();await expect(page.locator('#word-list h2')).toHaveText('証拠品');
  await page.getByRole('button',{name:'随机复习',exact:true}).click();await expect(page.locator('.review-word')).toHaveText('証拠品');
  await page.reload();await expect(page.locator('#source-tabs')).toContainText('日常生活');
});
for(const width of [375,1280]) test(`review six cards in three rows, without repeats at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950});
  const state=await mockCloud(page);await login(page);
  state.rows=Array.from({length:13},(_,i)=>({...initial,id:`review-${i}`,word:`单词${i}`,source:'逆转裁判'}));
  await page.locator('#refresh').click();await expect(page.locator('#word-count')).toHaveText('共 13 个单词');
  await page.getByRole('button',{name:'随机复习',exact:true}).click();
  const cards=page.locator('.review-card'),words=page.locator('.review-word');
  await expect(cards).toHaveCount(6);
  const reviewFont=await words.first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  expect(reviewFont).toBeCloseTo(Math.min(32,Math.max(17.6,width*.03))-2,1);
  const aligned = await cards.first().locator('.card-actions').evaluate(node => {
    const [edit, star] = [...node.children].map(child => child.getBoundingClientRect());
    return edit.y === star.y && edit.width === star.width && edit.height === star.height && edit.right <= star.left;
  });
  expect(aligned).toBe(true);
  expect(await cards.first().evaluate(node => {
    const word=node.querySelector('.review-word').getBoundingClientRect(), icon=node.querySelector('.edit-button').getBoundingClientRect();
    return Math.abs(word.top-icon.top)<5;
  })).toBe(true);
  await cards.first().locator('.edit-button').click();await expect(page.locator('#word-title')).toHaveText('编辑单词');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  const first=await words.allTextContents();
  const boxes=await cards.evaluateAll(nodes=>nodes.map(n=>({x:n.offsetLeft,y:n.offsetTop})));
  expect(new Set(boxes.map(b=>b.x)).size).toBe(2);expect(new Set(boxes.map(b=>b.y)).size).toBe(3);
  await cards.first().locator('.review-reveal').click();await expect(cards.first().locator('.review-answer')).toBeVisible();
  await expect(cards.nth(1).locator('.review-answer')).toBeHidden();
  await page.locator('#refresh').click();await expect(words).toHaveText(first);
  await expect(cards.first().locator('.review-answer')).toBeVisible();
  await page.locator('#next').click();await expect(cards).toHaveCount(6);
  const second=await words.allTextContents();expect(second.some(w=>first.includes(w))).toBe(false);
  await page.locator('#next').click();await expect(cards).toHaveCount(1);
  expect([...first,...second]).not.toContain((await words.allTextContents())[0]);
  await expect(page.locator('#next')).toBeDisabled();await expect(page.locator('#restart-review')).toBeVisible();
  await page.locator('#restart-review').click();await expect(cards).toHaveCount(6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
for(const width of [375,1280]) test(`confusion groups save, compare, self-test and edit at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const state=await mockCloud(page);await login(page);
  state.rows.push({...initial,id:'second',word:'証言',source:'日常生活',meaning:'证言'});
  await page.locator('#refresh').click();await expect(page.locator('#source-tabs')).toContainText('日常生活');
  await page.getByRole('button',{name:'易混淆',exact:true}).click();
  await page.locator('#add-confusion').click();await page.locator('#save-confusion').click();await expect(page.locator('#group-status')).toContainText('请选择');
  await page.getByLabel('加入 証拠品',{exact:true}).check();
  await page.locator('#group-source').selectOption('日常生活');await page.getByLabel('加入 証言',{exact:true}).check();
  await page.locator('#group-note').fill('物证和口头证言的区别');state.failSave=true;
  await page.locator('#save-confusion').click();await expect(page.locator('#group-status')).toContainText('操作未完成');await expect(page.locator('#group-chosen .chosen-word')).toHaveCount(2);
  state.failSave=false;await page.locator('#save-confusion').click();await expect(page.locator('#confusion-dialog')).not.toBeVisible();
  await expect(page.locator('.confusion-group h2')).toHaveText('証拠品／証言');await expect(page.locator('.confusion-word')).toHaveCount(2);
  await page.reload();await expect(page.locator('#word-count')).toHaveText('共 1 个单词');await page.getByRole('button',{name:'易混淆',exact:true}).click();
  await expect(page.locator('.confusion-word')).toHaveCount(2);
  await page.locator('#confusion-self-test').check();await expect(page.locator('.confusion-answer').first()).toBeHidden();
  await expect(page.locator('.source-chip').first()).toBeHidden();
  expect(await page.locator('.answer-toggle').first().evaluate(el=>getComputedStyle(el).display)).toBe('block');
  const lookupFont=await page.locator('#lookup').evaluate(el=>getComputedStyle(el).fontSize);
  for(const button of await page.locator('.confusion-group .actions button').all())expect(await button.evaluate(el=>getComputedStyle(el).fontSize)).toBe(lookupFont);
  await page.locator('.answer-toggle').first().click();await expect(page.locator('.confusion-answer').first()).toBeVisible();await expect(page.locator('.confusion-answer').nth(1)).toBeHidden();
  await page.getByRole('button',{name:'编辑组',exact:true}).click();await page.locator('#group-title').fill('证据与证言');await page.getByLabel('上移 証言',{exact:true}).click();await page.locator('#save-confusion').click();
  await expect(page.locator('.confusion-word h3').first()).toHaveText('証言');
  await page.locator('#confusion-search').fill('没有这个组');await expect(page.locator('.confusion-group')).toHaveCount(0);await page.locator('#confusion-search').fill('');
  await page.locator('#confusion-self-test').uncheck();await page.screenshot({path:`test-results/confusion-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'删除组',exact:true}).click();await expect(page.locator('.confusion-group')).toHaveCount(0);expect(state.rows).toHaveLength(2);
});
test('stars persist, failures are visible, and focused review filters by source without repeats',async({page})=>{
  const state=await mockCloud(page);await login(page);
  state.failSave=true;await page.locator('.word-item .star-button').click();
  await expect(page.locator('#status')).toContainText('操作未完成');
  await expect(page.locator('.word-item .star-button')).toHaveAttribute('aria-pressed','false');
  state.failSave=false;await page.locator('.word-item .star-button').click();
  await expect(page.locator('.word-item .star-button')).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(page.locator('.word-item .star-button')).toHaveAttribute('aria-pressed','true');
  state.rows=Array.from({length:10},(_,i)=>({...initial,id:`star-${i}`,word:`重点${i}`,source:i===9?'其他来源':'逆转裁判',is_starred:i!==8}));
  await page.locator('#refresh').click();await expect(page.locator('#word-count')).toHaveText('共 9 个单词');
  await page.getByRole('button',{name:'随机复习',exact:true}).click();await page.locator('#starred-only').check();
  await expect(page.locator('.review-card')).toHaveCount(6);
  const first=await page.locator('.review-word').allTextContents();expect(first).not.toContain('重点8');expect(first).not.toContain('重点9');
  await page.locator('#next').click();await expect(page.locator('.review-card')).toHaveCount(2);
  expect((await page.locator('.review-word').allTextContents()).some(w=>first.includes(w))).toBe(false);
  await expect(page.locator('#next')).toBeDisabled();
  await page.locator('.review-card .star-button').first().click();await expect(page.locator('.review-card')).toHaveCount(1);
  await expect(page.locator('.review-answer')).toBeHidden();
  await page.locator('.review-card .star-button').click();await expect(page.locator('.review-card')).toHaveCount(0);
  await expect(page.locator('#restart-review')).toBeVisible();
});
for(const width of [375,768,1280]) test(`layout no overlap at ${width}px, including long dictionary results`,async({page})=>{
  await page.setViewportSize({width,height:950});await mockCloud(page);await login(page);
  await expect(page.locator('.edit-button svg')).toHaveCount(1);
  const actionBoxes = await page.locator('.word-item .card-actions').evaluate(node => [...node.children].map(child => {
    const box = child.getBoundingClientRect(); return { y: box.y, width: box.width, height: box.height, left: box.left, right: box.right };
  }));
  expect(actionBoxes[0].y).toBe(actionBoxes[1].y);
  expect(actionBoxes[0].height).toBe(actionBoxes[1].height);
  expect(actionBoxes[0].right).toBeLessThanOrEqual(actionBoxes[1].left);
  const titleBox=await page.locator('.word-item h2').boundingBox();
  expect(Math.abs(titleBox.y-actionBoxes[0].y)).toBeLessThan(1);
  await page.screenshot({path:`test-results/card-actions-${width}.png`});
  const inspect=async(selector)=>page.locator(selector).evaluateAll(nodes=>nodes.map(node=>{
    const boxes=[...node.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.getBoundingClientRect());
    return boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
  }));
  expect(await inspect('.word-item, .word-heading, .workspace-heading, .account-bar, .selection-bar')).not.toContain(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('#lookup').click();await page.locator('#query').fill('shouko hin');await page.locator('#lookup-submit').click();await expect(page.locator('.dictionary-result')).toHaveCount(1);
  expect(await inspect('.dictionary-result, .dialog-header')).not.toContain(true);
  expect(await page.locator('#dictionary-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:`test-results/dictionary-${width}.png`});
  await page.locator('.dictionary-result').click();await expect(page.locator('#word-title')).toHaveText('新增单词');
  await expect(page.locator('#word-form [name="note"]')).toHaveValue('');
  expect(await inspect('#word-form .actions, #word-form .dialog-header')).not.toContain(true);
  expect(await page.locator('#word-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});
