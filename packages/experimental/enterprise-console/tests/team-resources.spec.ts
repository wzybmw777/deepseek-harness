import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamResources } from '../src/team-resources.ts'

const cleanups: Array<() => Promise<void>> = []

async function createResources(): Promise<{ root: string; resources: TeamResources }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-team-resources-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
  return { root, resources: new TeamResources(root) }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

describe('team resources', () => {
  it('stores workspace files and exposes their text for editing', async () => {
    const { root, resources } = await createResources()

    const created = await resources.createFile('team-a', '', 'notes.txt', Buffer.from('第一版'))
    expect(created).toMatchObject({ name: 'notes.txt', path: 'notes.txt', kind: 'file', size: 9 })

    const workspace = join(root, 'team-a', 'documents', 'deepseek-harness', 'default-workspace')
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('第一版')

    const listing = await resources.listFiles('team-a', '')
    expect(listing.entries).toEqual([expect.objectContaining({ name: 'notes.txt', path: 'notes.txt', kind: 'file' })])

    const text = await resources.readTextFile('team-a', 'notes.txt')
    expect(text).toMatchObject({ path: 'notes.txt', content: '第一版', editable: true })

    await resources.writeTextFile('team-a', 'notes.txt', '第二版')
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('第二版')

    await resources.renameEntry('team-a', 'notes.txt', 'renamed.txt')
    expect((await resources.readTextFile('team-a', 'renamed.txt')).content).toBe('第二版')

    await resources.deleteEntry('team-a', 'renamed.txt')
    expect((await resources.listFiles('team-a', '')).entries).toEqual([])
  })

  it('rejects traversal, hidden paths, and symlinks that leave the workspace', async () => {
    const { root, resources } = await createResources()

    await expect(resources.createFile('team-a', '..', 'escape.txt', Buffer.from('x')))
      .rejects.toMatchObject({ code: 'unsafe_path' })
    await expect(resources.createFile('team-a', '', '.env', Buffer.from('x')))
      .rejects.toMatchObject({ code: 'unsafe_path' })
    await expect(resources.createFile('../team', '', 'escape.txt', Buffer.from('x')))
      .rejects.toMatchObject({ code: 'invalid_team' })

    await resources.listFiles('team-a', '')
    const workspace = join(root, 'team-a', 'documents', 'deepseek-harness', 'default-workspace')
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'outside secret')
    await symlink(outside, join(workspace, 'escape.txt'))

    expect((await resources.listFiles('team-a', '')).entries).toEqual([])
    await expect(resources.readTextFile('team-a', 'escape.txt'))
      .rejects.toMatchObject({ code: 'unsafe_path' })
    await expect(resources.deleteEntry('team-a', 'escape.txt'))
      .rejects.toMatchObject({ code: 'unsafe_path' })
  })

  it('keeps files and skills separate between teams', async () => {
    const { resources } = await createResources()

    await resources.createFile('team-a', '', 'a.txt', Buffer.from('team a'))
    await resources.createSkill('team-a', {
      name: 'team-a-skill',
      description: 'Only team A can use this skill.',
      instructions: 'Use team A data.',
    })

    expect((await resources.listFiles('team-b', '')).entries).toEqual([])
    expect(await resources.listSkills('team-b')).toEqual([])
    await expect(resources.readTextFile('team-b', 'a.txt')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('creates, edits, lists, and deletes filesystem skills', async () => {
    const { root, resources } = await createResources()

    const created = await resources.createSkill('team-a', {
      name: 'release-notes',
      description: 'Write release notes for the team.',
      instructions: '# Release notes\n\nCollect changes and publish a summary.',
    })
    expect(created).toMatchObject({
      name: 'release-notes',
      description: 'Write release notes for the team.',
      managedBy: 'user',
    })

    const skillPath = join(root, 'team-a', 'home', 'skills', 'release-notes', 'SKILL.md')
    const raw = await readFile(skillPath, 'utf8')
    expect(raw).toContain('name: release-notes')
    expect(raw).toContain('description: Write release notes for the team.')
    expect(raw).toContain('Collect changes and publish a summary.')

    expect(await resources.listSkills('team-a')).toEqual([
      expect.objectContaining({ name: 'release-notes', description: 'Write release notes for the team.', managedBy: 'user' }),
    ])
    expect(await resources.readSkill('team-a', 'release-notes')).toMatchObject({
      name: 'release-notes',
      instructions: '# Release notes\n\nCollect changes and publish a summary.',
    })

    await resources.updateSkill('team-a', 'release-notes', {
      description: 'Publish team release notes.',
      instructions: '# Release notes\n\nInclude every merged change.',
    })
    expect(await resources.readSkill('team-a', 'release-notes')).toMatchObject({
      description: 'Publish team release notes.',
      instructions: '# Release notes\n\nInclude every merged change.',
    })

    await expect(resources.createSkill('team-a', {
      name: 'Not Kebab',
      description: 'invalid',
      instructions: 'invalid',
    })).rejects.toMatchObject({ code: 'invalid_skill_name' })
    await expect(resources.createSkill('team-a', {
      name: 'team-knowledge',
      description: 'reserved',
      instructions: 'reserved',
    })).rejects.toMatchObject({ code: 'reserved_skill' })

    await resources.deleteSkill('team-a', 'release-notes')
    expect(await resources.listSkills('team-a')).toEqual([])
    await expect(access(skillPath)).rejects.toThrow()
  })

  it('edits and deletes flat Markdown skills whose name differs from the file name', async () => {
    const { root, resources } = await createResources()
    const skillsRoot = join(root, 'team-a', 'home', 'skills')
    await mkdir(skillsRoot, { recursive: true })
    const flatPath = join(skillsRoot, 'legacy-file.md')
    await writeFile(flatPath, '---\nname: legacy-skill\ndescription: Flat skill.\n---\n\nFirst body.\n')

    expect(await resources.listSkills('team-a')).toEqual([
      expect.objectContaining({ name: 'legacy-skill', managedBy: 'user' }),
    ])
    expect(await resources.readSkill('team-a', 'legacy-skill')).toMatchObject({
      name: 'legacy-skill',
      instructions: 'First body.',
    })

    await resources.updateSkill('team-a', 'legacy-skill', {
      description: 'Updated flat skill.',
      instructions: 'Second body.',
    })
    expect(await resources.readSkill('team-a', 'legacy-skill')).toMatchObject({
      description: 'Updated flat skill.',
      instructions: 'Second body.',
    })

    await resources.deleteSkill('team-a', 'legacy-skill')
    expect(await resources.listSkills('team-a')).toEqual([])
    await expect(access(flatPath)).rejects.toThrow()
  })

  it('persists knowledge and regenerates a loadable team-knowledge skill', async () => {
    const { root, resources } = await createResources()

    const first = await resources.createKnowledge('team-a', {
      title: 'Deployment checklist',
      summary: 'How the team deploys safely.',
      body: 'Run the tests, build the image, then restart the service.',
      tags: ['deploy', 'operations'],
    })
    await resources.createKnowledge('team-a', {
      title: 'Customer escalation',
      summary: 'Who handles an urgent customer report.',
      body: 'Notify the owning engineer and open an incident note.',
      tags: ['support'],
    })

    expect(await resources.listKnowledge('team-a')).toHaveLength(2)
    expect(await resources.readKnowledge('team-a', first.id)).toMatchObject({
      title: 'Deployment checklist',
      tags: ['deploy', 'operations'],
    })

    const skillPath = join(root, 'team-a', 'home', 'skills', 'team-knowledge', 'SKILL.md')
    const skill = await readFile(skillPath, 'utf8')
    expect(skill).toContain('name: team-knowledge')
    expect(skill).toContain('Deployment checklist')
    expect(skill).toContain('Customer escalation')

    const references = join(root, 'team-a', 'home', 'skills', 'team-knowledge', 'references')
    expect((await readdir(references)).filter(name => name.endsWith('.md'))).toHaveLength(2)
    expect(await resources.listSkills('team-a')).toEqual([
      expect.objectContaining({ name: 'team-knowledge', managedBy: 'knowledge' }),
    ])

    await resources.updateKnowledge('team-a', first.id, {
      title: 'Deployment checklist v2',
      summary: 'Updated deployment steps.',
      body: 'Run the complete verification suite before restarting.',
      tags: ['deploy'],
    })
    const updatedSkill = await readFile(skillPath, 'utf8')
    expect(updatedSkill).toContain('Deployment checklist v2')
    expect(updatedSkill).not.toContain('Deployment checklist\n')
    const updatedReferences = (await readdir(references)).filter(name => name.endsWith('.md'))
    const referenceText = await Promise.all(updatedReferences.map(name => readFile(join(references, name), 'utf8')))
    expect(referenceText.join('\n')).toContain('Run the complete verification suite before restarting.')

    const stored = JSON.parse(await readFile(join(root, 'team-a', 'resources', 'knowledge', 'articles.json'), 'utf8')) as {
      articles: Array<{ title: string }>
    }
    expect(stored.articles.map(article => article.title)).toContain('Deployment checklist v2')

    await resources.deleteKnowledge('team-a', first.id)
    await resources.deleteKnowledge('team-a', (await resources.listKnowledge('team-a'))[0]?.id ?? '')
    expect(await resources.listKnowledge('team-a')).toEqual([])
    await expect(access(join(root, 'team-a', 'home', 'skills', 'team-knowledge'))).rejects.toThrow()
  })
})
