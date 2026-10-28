import { client } from './api.js';
const $ = selector => document.querySelector(selector);
const node = (tag, cls, text='') => { const el=document.createElement(tag);el.className=cls;el.textContent=text;return el; };
let groups=[], words=[], editing=null, chosen=[], pending=false, selfTest=false;
export async function fetchGroups() {
  const all=[];
  for(let from=0;;from+=500){
    const {data,error}=await client.from('confusion_groups').select('*,confusion_group_words(word_id,position)').order('created_at').order('id').range(from,from+499);
    if(error) throw error;
    all.push(...data);if(data.length<500)return all;
  }
}
export function updateConfusion(rows, vocabulary) { groups=rows;words=vocabulary;render(); }
function render() {
  const list=$('#confusion-list');list.replaceChildren();
  const query=$('#confusion-search').value.trim().toLowerCase();
  const visible=groups.filter(g=>[g.title,g.note,...g.confusion_group_words.map(m=>words.find(w=>w.id===m.word_id)?.word||'')].join(' ').toLowerCase().includes(query));
  $('#confusion-count').textContent=`共 ${groups.length} 个易混淆组 · 跨来源展示`;
  if(!visible.length)list.append(node('p','empty',groups.length?'没有匹配的分组。':'还没有易混淆组，选择两个或更多已有单词开始对比。'));
  for(const group of visible){
    const section=node('article','confusion-group panel'),heading=node('div','dialog-header');
    heading.append(node('h2','',group.title));
    const actions=node('div','actions'),edit=node('button','','编辑组'),remove=node('button','danger','删除组');
    edit.onclick=()=>open(group);remove.onclick=()=>{
      if(!pending&&confirm(`删除易混淆组「${group.title}」？原单词不会删除。`)) saveAction(remove,async()=>{
        const {data,error}=await client.from('confusion_groups').delete().eq('id',group.id).eq('version',group.version).select('id');
        if(error)throw error;if(!data.length)throw new Error('分组已修改或删除，请同步后重试');
      });
    };
    actions.append(edit,remove);heading.append(actions);section.append(heading);
    const members=[...group.confusion_group_words].sort((a,b)=>a.position-b.position).map(m=>words.find(w=>w.id===m.word_id)).filter(Boolean);
    if(members.length<2)section.append(node('p','muted','待补充：组内不足两个单词，请编辑组添加。'));
    const grid=node('div','confusion-cards');
    for(const word of members){
      const card=node('article','confusion-word');card.append(node('h3','',word.word));
      const answer=node('div','confusion-answer');answer.hidden=selfTest;
      answer.append(node('span','source-chip',word.source),node('p','reading',word.reading||'读音待补充'),node('p','meaning',word.meaning||'释义待补充'));
      if(word.example)answer.append(node('p','example',word.example));
      if(word.note){const details=node('details','note');details.append(node('summary','','备注'),node('p','',word.note));answer.append(details);}
      const reveal=node('button','answer-toggle',selfTest?'显示答案':'隐藏答案');
      reveal.setAttribute('aria-expanded',String(!answer.hidden));
      reveal.onclick=()=>{answer.hidden=!answer.hidden;reveal.textContent=answer.hidden?'显示答案':'隐藏答案';reveal.setAttribute('aria-expanded',String(!answer.hidden));};
      card.append(answer,reveal);grid.append(card);
    }
    section.append(grid);
    if(group.note){const details=node('details','group-note');details.open=!selfTest;details.append(node('summary','','区分笔记'),node('p','',group.note));section.append(details);}
    list.append(section);
  }
}
function open(group=null){
  editing=group;chosen=group?[...group.confusion_group_words].sort((a,b)=>a.position-b.position).map(m=>m.word_id).filter(id=>words.some(w=>w.id===id)):[];
  $('#confusion-form').reset();$('#group-title').value=group?.title||'';$('#group-note').value=group?.note||'';
  $('#group-dialog-title').textContent=group?'编辑易混淆组':'新建易混淆组';$('#group-status').textContent='';
  $('#group-source').replaceChildren(new Option('全部来源',''),...[...new Set(words.map(w=>w.source))].map(s=>new Option(s,s)));
  renderPicker();$('#confusion-dialog').showModal();$('#group-title').focus();
}
function renderPicker(){
  const list=$('#group-picker');list.replaceChildren();
  const selected=$('#group-chosen');selected.replaceChildren();
  chosen.forEach((id,i)=>{
    const word=words.find(w=>w.id===id);if(!word)return;
    const item=node('div','chosen-word'),up=node('button','','↑'),remove=node('button','','移除');
    up.type=remove.type='button';up.disabled=i===0;up.setAttribute('aria-label',`上移 ${word.word}`);remove.setAttribute('aria-label',`移除 ${word.word}`);
    up.onclick=()=>{[chosen[i-1],chosen[i]]=[chosen[i],chosen[i-1]];renderPicker();};remove.onclick=()=>{chosen=chosen.filter(x=>x!==id);renderPicker();};
    item.append(node('span','',word.word),up,remove);selected.append(item);
  });
  $('#group-selected-count').textContent=`已选 ${chosen.length} 个 · 至少选 2 个，可跨来源选择`;
  const query=$('#group-query').value.trim().toLowerCase(),source=$('#group-source').value;
  const matches=words.filter(w=>(!source||w.source===source)&&[w.word,w.reading,w.meaning].join(' ').toLowerCase().includes(query));
  if(!matches.length)list.append(node('p','muted','没有匹配的单词'));
  for(const word of matches){
    const label=node('label','picker-word'),check=document.createElement('input');check.type='checkbox';check.checked=chosen.includes(word.id);check.setAttribute('aria-label',`加入 ${word.word}`);
    check.onchange=()=>{chosen=check.checked?[...chosen,word.id]:chosen.filter(id=>id!==word.id);renderPicker();};
    label.append(check,node('span','',`${word.word} · ${word.reading||'—'} · ${word.meaning||'—'}（${word.source}）`));list.append(label);
  }
}
async function saveAction(button,action,close=false){
  if(pending)return;pending=true;button.disabled=true;
  const account=(await client.auth.getUser()).data.user?.id;
  const target=close?$('#group-status'):$('#confusion-status');target.textContent='正在保存…';
  try{
    await action();const rows=await fetchGroups();
    if((await client.auth.getUser()).data.user?.id!==account)return;
    groups=rows;render();target.textContent='已保存到云端';if(close)$('#confusion-dialog').close();
  }catch(error){target.textContent=`操作未完成：${error.message}`;}
  finally{pending=false;button.disabled=false;}
}
export function initConfusion(){
  $('#add-confusion').onclick=()=>open();$('#confusion-search').oninput=render;
  $('#confusion-self-test').onchange=event=>{selfTest=event.target.checked;render();};
  $('#group-query').oninput=renderPicker;$('#group-source').onchange=renderPicker;
  $('#confusion-form').onsubmit=event=>{
    event.preventDefault();const title=$('#group-title').value.trim()||chosen.map(id=>words.find(w=>w.id===id)?.word).filter(Boolean).join('／');
    if(chosen.length<2||chosen.length>100||!title||title.length>200){$('#group-status').textContent='请选择 2 至 100 个单词，组名不超过 200 字';return;}
    saveAction($('#save-confusion'),async()=>{
      const {error}=await client.rpc('save_confusion_group',{target:editing?.id||null,expected_version:editing?.version||null,group_title:title,group_note:$('#group-note').value.trim(),word_ids:chosen});if(error)throw error;
    },true);
  };
}
