const { git } = require('@commitlint/test')
const execa = require('execa')
const td = require('testdouble')
const {
  updateEnvVars,
  gitEmptyCommit,
  getCommitHashes,
  updatePushEnvVars,
  createPushEventPayload,
  createPullRequestEventPayload,
  updatePullRequestEnvVars,
} = require('./testUtils')

const {
  matchers: { contains },
} = td

const initialEnv = { ...process.env }

const listCommits = td.func('listCommits')

const runAction = () => {
  const github = require('@actions/github')
  class MockOctokit {
    constructor() {
      this.pulls = {
        listCommits,
      }
    }
  }

  updateEnvVars({ GITHBU_TOKEN: 'test-github-token' })
  td.replace(github, 'GitHub', MockOctokit)

  return require('./action')()
}

describe('Commit Linter action', () => {
  let core
  let cwd

  beforeEach(() => {
    core = require('@actions/core')
    td.replace(core, 'getInput')
    td.replace(core, 'setFailed')
    td.when(core.getInput('configFile')).thenReturn('./commitlint.config.js')
    td.when(core.getInput('firstParent')).thenReturn('true')
    td.when(core.getInput('failOnWarnings')).thenReturn('false')
    td.when(core.getInput('helpURL')).thenReturn(
      'https://github.com/conventional-changelog/commitlint/#what-is-commitlint',
    )
  })

  afterEach(() => {
    td.reset()
    process.env = initialEnv
    jest.resetModules()
  })

  it('should fail for single push with incorrect message', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'wrong message')
    const [to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(core.setFailed(contains('You have commit messages with errors')))
  })

  it('should pass for single push with correct message', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'chore: correct message')
    const [to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)
    td.replace(console, 'log')

    await runAction()

    td.verify(core.setFailed(), { times: 0, ignoreExtraArgs: true })
    td.verify(console.log('Lint free! 🎉'))
  })

  it('should fail for push range with wrong messages', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'message from before push')
    await gitEmptyCommit(cwd, 'wrong message 1')
    await gitEmptyCommit(cwd, 'wrong message 2')
    const [before, , to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { before, to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(core.setFailed(contains('wrong message 1')))
    td.verify(core.setFailed(contains('wrong message 2')))
  })

  it('should pass for push range with correct messages', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'message from before push')
    await gitEmptyCommit(cwd, 'chore: correct message 1')
    await gitEmptyCommit(cwd, 'chore: correct message 2')
    const [before, , to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { before, to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)
    td.replace(console, 'log')

    await runAction()

    td.verify(core.setFailed(), { times: 0, ignoreExtraArgs: true })
    td.verify(console.log('Lint free! 🎉'))
  })

  it('should lint only last commit for forced push', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'message from before push')
    await gitEmptyCommit(cwd, 'wrong message 1')
    await gitEmptyCommit(cwd, 'wrong message 2')
    const [before, , to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { before, to, forced: true })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)
    td.replace(console, 'warn')

    await runAction()

    td.verify(
      console.warn(
        'Commit was forced, checking only the latest commit from push instead of a range of commit messages',
      ),
    )
    td.verify(core.setFailed(contains('wrong message 1')), { times: 0 })
    td.verify(core.setFailed(contains('wrong message 2')))
  })

  it('should lint only last commit when "before" field is an empty sha', async () => {
    const gitEmptySha = '0000000000000000000000000000000000000000'
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'message from before push')
    await gitEmptyCommit(cwd, 'wrong message 1')
    await gitEmptyCommit(cwd, 'chore(WRONG): message 2')
    const [before, , to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { before: gitEmptySha, to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(core.setFailed(contains('wrong message 1')), { times: 0 })
    td.verify(core.setFailed(contains('chore(WRONG): message 2')))
  })

  it('should fail for commit with scope that is not a lerna package', async () => {
    cwd = await git.bootstrap('fixtures/lerna-scopes')
    td.when(core.getInput('configFile')).thenReturn('./commitlint.config.yml')
    await gitEmptyCommit(cwd, 'chore(wrong): not including package scope')
    const [to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(
      core.setFailed(contains('chore(wrong): not including package scope')),
    )
  })

  it('should pass for scope that is a lerna package', async () => {
    cwd = await git.bootstrap('fixtures/lerna-scopes')
    td.when(core.getInput('configFile')).thenReturn('./commitlint.config.yml')
    await gitEmptyCommit(cwd, 'chore(second-package): this works')
    const [to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)
    td.replace(console, 'log')

    await runAction()

    td.verify(console.log('Lint free! 🎉'))
  })

  it("should fail for commit that doesn't comply with jira rules", async () => {
    cwd = await git.bootstrap('fixtures/jira')
    td.when(core.getInput('configFile')).thenReturn('./commitlint.config.js')
    await gitEmptyCommit(cwd, 'ib-21212121212121: without jira ticket')
    const [to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(
      core.setFailed(contains('ib-21212121212121: without jira ticket')),
    )
    td.verify(
      core.setFailed(
        contains(
          'ib-21212121212121 taskId must not be loonger than 9 characters',
        ),
      ),
    )
    td.verify(
      core.setFailed(
        contains('ib-21212121212121 taskId must be uppercase case'),
      ),
    )
    td.verify(
      core.setFailed(
        contains('ib-21212121212121 commitStatus must be uppercase case'),
      ),
    )
  })

  it('should NOT consider commits from another branch', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'chore: commit before')
    await gitEmptyCommit(cwd, 'chore: correct message')
    await execa.command('git checkout -b another-branch', { cwd })
    await gitEmptyCommit(cwd, 'wrong commit from another branch')
    await execa.command('git checkout -', { cwd })
    await execa.command('git merge --no-ff another-branch', { cwd })
    const [before, , to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { before, to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)
    td.replace(console, 'log')

    await runAction()

    td.verify(console.log('Lint free! 🎉'))
  })

  it('should consider commits from another branch when firstParent is false', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    await gitEmptyCommit(cwd, 'chore: commit before')
    await gitEmptyCommit(cwd, 'chore: correct message')
    await execa.command('git checkout -b another-branch', { cwd })
    await gitEmptyCommit(cwd, 'wrong commit from another branch')
    await execa.command('git checkout -', { cwd })
    await execa.command('git merge --no-ff another-branch', { cwd })
    const [before, , , to] = await getCommitHashes(cwd)
    await createPushEventPayload(cwd, { before, to })
    updatePushEnvVars(cwd, to)
    td.replace(process, 'cwd', () => cwd)
    td.when(core.getInput('firstParent')).thenReturn('false')

    await runAction()

    td.verify(core.setFailed(contains('wrong commit from another branch')))
  })

  it('should lint all commits from a pull request', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    td.when(core.getInput('configFile')).thenReturn('./commitlint.config.js')
    await gitEmptyCommit(cwd, 'message from before push')
    await gitEmptyCommit(cwd, 'wrong message 1')
    await gitEmptyCommit(cwd, 'wrong message 2')
    await gitEmptyCommit(cwd, 'wrong message 3')
    await createPullRequestEventPayload(cwd)
    const [, first, second, to] = await getCommitHashes(cwd)
    updatePullRequestEnvVars(cwd, to)
    td.when(
      listCommits({
        owner: 'wagoid',
        repo: 'commitlint-github-action',
        pull_number: '1',
      }),
    ).thenResolve({
      data: [first, second, to].map(sha => ({ sha })),
    })
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(core.setFailed(contains('message from before push')), {
      times: 0,
    })
    td.verify(core.setFailed(contains('wrong message 1')))
    td.verify(core.setFailed(contains('wrong message 2')))
    td.verify(core.setFailed(contains('wrong message 3')))
  })

  it('should show an error message when failing to fetch commits', async () => {
    cwd = await git.bootstrap('fixtures/conventional')
    td.when(core.getInput('configFile')).thenReturn('./commitlint.config.js')
    await gitEmptyCommit(cwd, 'commit message')
    await createPullRequestEventPayload(cwd)
    const [to] = await getCommitHashes(cwd)
    updatePullRequestEnvVars(cwd, to)
    td.when(
      listCommits({
        owner: 'wagoid',
        repo: 'commitlint-github-action',
        pull_number: '1',
      }),
    ).thenReject(new Error('HttpError: Bad credentials'))
    td.replace(process, 'cwd', () => cwd)

    await runAction()

    td.verify(
      core.setFailed(
        contains("error trying to get list of pull request's commits"),
      ),
    )
    td.verify(core.setFailed(contains('HttpError: Bad credentials')))
  })

  describe('when all errors are just warnings', () => {
    beforeEach(async () => {
      cwd = await git.bootstrap('fixtures/conventional')
      await gitEmptyCommit(
        cwd,
        'chore: correct message\nsome context without leading blank line',
      )
      const [to] = await getCommitHashes(cwd)
      await createPushEventPayload(cwd, { to })
      updatePushEnvVars(cwd, to)
      td.replace(process, 'cwd', () => cwd)
      td.replace(console, 'log')
    })

    it('should pass and show that warnings exist', async () => {
      await runAction()

      td.verify(core.setFailed(), { times: 0, ignoreExtraArgs: true })
      td.verify(console.log(contains('You have commit messages with warnings')))
    })

    describe('and failOnWarnings is set to true', () => {
      beforeEach(() => {
        td.when(core.getInput('failOnWarnings')).thenReturn('true')
      })

      it('should fail', async () => {
        await runAction()

        td.verify(
          core.setFailed(contains('You have commit messages with errors')),
        )
      })
    })
  })

  describe('when a subset of errors are just warnings', () => {
    beforeEach(async () => {
      cwd = await git.bootstrap('fixtures/conventional')
      await gitEmptyCommit(
        cwd,
        'chore: correct message\nsome context without leading blank line',
      )
      await gitEmptyCommit(cwd, 'wrong message')
      const [before, to] = await getCommitHashes(cwd)
      await createPushEventPayload(cwd, { before, to })
      updatePushEnvVars(cwd, to)
      td.replace(process, 'cwd', () => cwd)
      td.replace(console, 'log')
    })

    it('should fail', async () => {
      await runAction()

      td.verify(
        core.setFailed(contains('You have commit messages with errors')),
      )
    })

    describe('and failOnWarnings is set to true', () => {
      beforeEach(() => {
        td.when(core.getInput('failOnWarnings')).thenReturn('true')
      })

      it('should fail', async () => {
        await runAction()

        td.verify(
          core.setFailed(contains('You have commit messages with errors')),
        )
      })
    })
  })
})
