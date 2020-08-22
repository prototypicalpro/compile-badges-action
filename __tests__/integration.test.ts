import * as cp from 'child_process'
import * as path from 'path'
import * as process from 'process'
import * as tmp from 'tmp'
import * as fs from 'fs'
import {Inputs} from '../src/main'

async function execAsync(
  command: string,
  opts: cp.ExecOptions
): Promise<{out: string; err: string; code: number}> {
  return new Promise((resolve, reject) => {
    cp.exec(command, opts, (err, outstd, errstd) =>
      err !== null && err.code === undefined
        ? reject(err)
        : resolve({
            out: outstd,
            err: errstd,
            code: err !== null ? (err.code as number) : 0
          })
    )
  })
}

async function runAction(
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<{out: string; err: string; code: number}> {
  const ip = path.join(__dirname, '..', 'dist', 'index.js')
  return execAsync(`node ${ip}`, {env, cwd})
}

function getInputName(input: string): string {
  return `INPUT_${input.replace(/ /g, '_').toUpperCase()}`
}

async function getTempFile(): Promise<{
  filePath: string
  fileRemove: () => void
}> {
  return new Promise((resolve, reject) => {
    tmp.file((err, name, fd, removeCallback) => {
      if (err) reject(err)
      resolve({filePath: name, fileRemove: removeCallback})
    })
  })
}

async function getTempDir(): Promise<{dirPath: string; dirRemove: () => void}> {
  return new Promise((resolve, reject) => {
    tmp.dir((err, name, removeCallback) => {
      if (err) reject(err)
      resolve({dirPath: name, dirRemove: removeCallback})
    })
  })
}

describe('integration', () => {
  let outputRemove: () => void
  let workingRemove: () => void
  const svgInPath = path.resolve(__dirname, 'test.svg')
  let baseEnv: NodeJS.ProcessEnv = {}
  let workingDir: string

  beforeEach(async () => {
    const {filePath, fileRemove} = await getTempFile()
    const {dirPath, dirRemove} = await getTempDir()
    workingDir = dirPath
    workingRemove = dirRemove
    outputRemove = fileRemove
    baseEnv = Object.assign({}, process.env)
    baseEnv[getInputName(Inputs.CUR_REPO)] = 'testowner/testrepo'
    baseEnv[getInputName(Inputs.CUR_BRANCH)] = 'refs/head/main'
    baseEnv[getInputName(Inputs.INPUT_FILE)] = path.resolve(
      __dirname,
      'TEST_INPUT.md'
    )
    baseEnv[getInputName(Inputs.OUTPUT_MARKDOWN_FILE)] = filePath
    baseEnv[getInputName(Inputs.OUTPUT_IMG_DIR)] = 'test-svg-dir'
  })

  afterEach(async () => {
    outputRemove()
    workingRemove()
  })

  it('replaces a badge in a markdown file', async () => {
    const {code} = await runAction(baseEnv, workingDir)

    const expectedSvg = await fs.promises.readFile(svgInPath, 'utf-8')
    const actual = await fs.promises.readFile(
      baseEnv[getInputName(Inputs.OUTPUT_MARKDOWN_FILE)] as string,
      'utf-8'
    )
    const actualSvg = await fs.promises.readFile(
      path.join(workingDir, 'test-svg-dir', 'badge-0.svg'),
      'utf-8'
    )
    expect(code).toBeFalsy()
    const actualSplit = actual.split('\n').filter(s => s)
    expect(actualSplit).toMatchObject([
      expect.stringContaining('<!-- badge-compile -->'),
      expect.stringContaining(
        '![alt text](https://raw.githubusercontent.com/testowner/testrepo/main/test-svg-dir/badge-0.svg)'
      ),
      expect.stringContaining('<!-- badge-compile-stop -->')
    ])
    expect(actualSvg).toEqual(expectedSvg)
  })
})
