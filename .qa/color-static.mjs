import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
const before = path.resolve(process.env.BEFORE_DIR || 'before');
const after = path.resolve(process.env.AFTER_DIR || 'after');
const whitelistPath = path.resolve(process.env.COLOR_WHITELIST || path.join(path.dirname(new URL(import.meta.url).pathname), 'purple-whitelist.json'));
const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
const out = path.resolve(process.env.QA_OUT || 'qa-results');
fs.mkdirSync(out, {recursive:true});
const result = { passed:false, checks:[], permittedChanges:whitelist.changes };
function files(dir, prefix='') { return fs.readdirSync(path.join(dir,prefix),{withFileTypes:true}).flatMap(e=>{if(e.name==='.git')return [];const relative=path.posix.join(prefix,e.name);if(e.isSymbolicLink())throw Error('Unexpected symlink '+relative);return e.isDirectory()?files(dir,relative):[relative]}).sort(); }
function clean(n){if(n===null||typeof n!=='object')return n;if(Array.isArray(n))return n.map(clean);return Object.fromEntries(Object.entries(n).filter(([k])=>!['raws','source','inputs'].includes(k)).map(([k,v])=>[k,clean(v)]));}
try {
 const originalFiles=files(before), changedFiles=files(after);
 assert.deepEqual(changedFiles,originalFiles,'Added or removed files are forbidden in color-only stage');
 assert.equal(whitelist.changes.length,23,'Expected the approved 23 declarations');
 for(const filename of originalFiles) {
  if(filename==='css/home.css')continue;
  if(filename==='README.md') {
    const a=fs.readFileSync(path.join(before,filename),'utf8');
    const b=fs.readFileSync(path.join(after,filename),'utf8');
    const oldPhrase='destaque, que varia entre o tema compartilhado e a página inicial.';
    const newPhrase='destaque usada nos elementos visuais do site.';
    assert.equal(a.split(oldPhrase).length,2,'Expected README phrase exactly once');
    assert.equal(b,a.replace(oldPhrase,newPhrase),'README may only receive the approved accent-description correction');
    continue;
  }
  assert(fs.readFileSync(path.join(before,filename)).equals(fs.readFileSync(path.join(after,filename))), 'Non-home file changed: '+filename);
 }
 const source=postcss.parse(fs.readFileSync(path.join(before,'css/home.css'),'utf8'));
 const target=postcss.parse(fs.readFileSync(path.join(after,'css/home.css'),'utf8'));
 const seen=[];
 for(const change of whitelist.changes) {
  assert.equal(change.file,'css/home.css');
  const matches=[];
  source.walkDecls(d=>{
   const context=[];let p=d.parent;while(p&&p.type!=='root'){context.unshift(p.type==='rule'?p.selector:'@'+p.name+(p.params?' '+p.params:''));p=p.parent;}
   if(JSON.stringify(context)===JSON.stringify(change.context)&&d.parent.selector===change.selector&&d.prop===change.property&&d.value===change.before&&Boolean(d.important)===change.important)matches.push(d);
  });
  assert.equal(matches.length,1,'Whitelist declaration must resolve uniquely: '+JSON.stringify(change));
  const expected=change.before.replace(/#[\da-f]{8}|#[\da-f]{6}|#[\da-f]{3}\b/gi, hex=>whitelist.colorMap[hex.toLowerCase()]||hex);
  assert.equal(change.after,expected,'Only approved color-token replacements are allowed');
  matches[0].value=change.after;seen.push(change);
 }
 assert.deepEqual(clean(postcss.parse(source.toString()).toJSON()),clean(target.toJSON()),'CSS AST differs beyond approved exact color value replacements');
 result.passed=true;result.checks=[`All ${originalFiles.length} paths identical (excluding .git)`,`${originalFiles.length-2} non-home/non-README files byte-identical`,'README contains only the approved one-sentence accent-description correction','Exactly 23 approved home declaration replacements; every selector, rule order, property, importance and other value preserved'];
 console.log('PASS color-only source validation',JSON.stringify(result.checks));
} catch(error) {result.error=error.stack;console.error(error);process.exitCode=1;}
finally {fs.writeFileSync(path.join(out,'color-static-report.json'),JSON.stringify(result,null,2));}
