import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, copyFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('setup keeps credentials private, makes rate metadata container-readable and preserves keys on rerun',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tpv-setup-test-'))
  try {
    await mkdir(join(root,'config'));await mkdir(join(root,'docs/news'),{recursive:true})
    for(const file of ['config/news.env.example','docs/news/pricing.example.json'])await copyFile(file,join(root,file))
    const setup=()=>{
      const result=spawnSync(process.execPath,[resolve('scripts/news-setup.mjs'),'setup'],{cwd:root,encoding:'utf8',timeout:10000})
      assert.equal(result.status,0,'Synthetic setup should succeed without Docker or provider access')
    }
    setup()
    const keys=await readFile(join(root,'.local/news.generated.env'),'utf8')
    setup()
    assert.equal(await readFile(join(root,'.local/news.generated.env'),'utf8'),keys)
    for(const file of ['.env.news.local','.local/news.generated.env','.local/news-access.txt'])assert.equal((await stat(join(root,file))).mode&0o777,0o600)
    assert.equal((await stat(join(root,'.local/news-pricing.json'))).mode&0o777,0o644)
  } finally {await rm(root,{recursive:true,force:true})}
})
