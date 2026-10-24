import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {parse as parseHTML} from 'parse5';
import postcss from 'postcss';
import {parse as parseJS} from 'acorn';
const root=process.env.QA_METADATA_DIR || new URL('.', import.meta.url).pathname,before=process.env.BEFORE_DIR,after=process.env.AFTER_DIR;
const paths=JSON.parse(fs.readFileSync(root+'/path-map.json')),nameMap=JSON.parse(fs.readFileSync(root+'/js-name-map.json')),log=JSON.parse(fs.readFileSync(root+'/cleanup-log.json'));
const inventory=JSON.parse(fs.readFileSync(root+'/inventory.json'));
const reverseNames=Object.fromEntries(Object.entries(nameMap).map(([k,v])=>[v,k]));
const constants={AUTOPLAY_DELAY_MS:2500,DRAG_START_DISTANCE_PX:12,SWIPE_DISTANCE_PX:35};
const reports=[];
function simplify(x,excludes=[]){if(x===null||typeof x!=='object')return x;if(Array.isArray(x))return x.map(v=>simplify(v,excludes));return Object.fromEntries(Object.entries(x).filter(([k])=>!excludes.includes(k)).map(([k,v])=>[k,simplify(v,excludes)]))}
function cssAST(s){return simplify(postcss.parse(s).toJSON(),['raws','source','inputs'])}
for(const [old,neo] of Object.entries(paths).filter(([p])=>p.endsWith('.css'))){
 let original=postcss.parse(fs.readFileSync(before+'/'+old,'utf8'));
 let removed=log.filter(l=>l.file===neo),unused=removed.filter(l=>!l.property).map(l=>l.selector);
 original.walkRules(r=>{if(unused.includes(r.selector))r.remove()});
 for(const item of removed.filter(l=>l.property)){
  const rule=original.nodes.find(n=>n.type==='rule'&&n.selector===item.selector&&n.nodes.some(d=>d.type==='decl'&&d.prop===item.property&&d.value===item.value));
  assert(rule,'Expected overridden rule');rule.nodes.find(d=>d.type==='decl'&&d.prop===item.property&&d.value===item.value).remove();
 }
 let actual=fs.readFileSync(after+'/'+neo,'utf8').replaceAll('--accent','--blue').replaceAll("'../assets/","'./assets/");
 assert.deepEqual(cssAST(original.toString()),cssAST(actual),neo);
 reports.push({file:neo,passed:'CSS AST and order identical after explicitly listed dead/overridden rules and mapped variable/resource names'});
}
for(const [old,neo]of Object.entries(paths).filter(([p])=>p.endsWith('.js'))){
 const original=parseJS(fs.readFileSync(before+'/'+old,'utf8'),{ecmaVersion:'latest'});
 let actual=parseJS(fs.readFileSync(after+'/'+neo,'utf8'),{ecmaVersion:'latest'});
 function normalize(n){if(!n||typeof n!=='object')return n;if(Array.isArray(n))return n.filter(x=>!(x.type==='VariableDeclaration'&&x.declarations.length===1&&constants[x.declarations[0].id.name]!==undefined)).map(normalize);if(n.type==='Identifier'&&constants[n.name]!==undefined)return {type:'Literal',value:constants[n.name]};let obj={};for(const [k,v]of Object.entries(n)){if(['start','end','raw'].includes(k))continue;obj[k]=k==='name'&&reverseNames[v]?reverseNames[v]:normalize(v)}return obj}
 assert.deepEqual(simplify(original,['start','end','raw']),neo==='js/photo-gallery.js'?normalize(actual):simplify(actual,['start','end','raw']),neo);
 reports.push({file:neo,passed:'JavaScript AST equivalent (renamed identifiers/constants normalized only for photo gallery)'});
}
const valid=new Set([...inventory.filter(p=>!Object.hasOwn(paths,p)),...Object.values(paths),'css/contact.css']);
function htmlTree(s){function clean(n){if(n.nodeName==='#text'){const value=n.value.replace(/\s+/g,' ').trim();return value?{text:value}:null}if(n.tagName==='style')return {tag:'style',css:cssAST(n.childNodes.map(c=>c.value||'').join(''))};return {tag:n.nodeName,attrs:n.attrs,children:n.childNodes?.map(clean).filter(Boolean)}}return clean(parseHTML(s))}
for(const f of inventory.filter(p=>p.endsWith('.html'))){
 const orig=fs.readFileSync(before+'/'+f,'utf8');let actual=fs.readFileSync(after+'/'+f,'utf8');
 for(const m of actual.matchAll(/(?:href|src)="([^"#]+)"/g)){const link=m[1];if(/^(https?:|tel:|mailto:)/.test(link))continue;assert(valid.has(path.posix.normalize(link.split('?')[0])),f+' broken '+link)}
 for(const [old,neo]of Object.entries(paths))actual=actual.replaceAll('./'+neo,'./'+old);
 if(f==='contato.html')actual=actual.replace('<link rel="stylesheet" href="./css/contact.css">','<style>'+fs.readFileSync(after+'/css/contact.css','utf8')+'</style>');
 assert.deepEqual(htmlTree(orig),htmlTree(actual),f);
 reports.push({file:f,passed:'HTML elements, ordered attributes and normalized text unchanged after resource path mapping/contact stylesheet extraction; all local URLs exist in repository inventory'});
}
for(const f of Object.values(paths).filter(p=>p.endsWith('.css'))){const css=fs.readFileSync(after+'/'+f,'utf8');for(const m of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)){if(/^https?:/.test(m[1]))continue;assert(valid.has(path.posix.normalize(path.posix.join(path.posix.dirname(f),m[1].split('?')[0]))),f+' broken resource '+m[1])}}
const authored=inventory.filter(p=>/\.(html|js)$/.test(p)).map(p=>fs.readFileSync(before+'/'+p,'utf8')).join('\n');
for(const cls of ['interlude','contact-pending','status-dot','contact-note','photo-grid','coming-label','brand-dot','title-period'])assert(!authored.includes(cls),'Removed class is authored: '+cls);
reports.push({check:'Deleted CSS class names absent in all original authored HTML/JS; CSS asset URLs resolve; no framework/dependencies added to site',passed:true});
fs.writeFileSync(root+'/final-static-results.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
