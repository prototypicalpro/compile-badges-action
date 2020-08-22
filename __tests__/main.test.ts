import run, {
  scanForBadges,
  replaceBadgeUrls,
  filterBadgeUrls,
  fetchAndWriteBadge,
  Inputs
} from '../src/main'
import nock from 'nock'
import * as tmp from 'tmp'
import * as path from 'path'
import * as fs from 'fs'
import rimraf from 'rimraf'

function getInputName(input: string): string {
  return `INPUT_${input.replace(/ /g, '_').toUpperCase()}`
}

async function getTempDir(): Promise<{dirPath: string; dirRemove: () => void}> {
  return new Promise((resolve, reject) => {
    tmp.dir((err, name, removeCallback) => {
      if (err) reject(err)
      resolve({dirPath: name, dirRemove: removeCallback})
    })
  })
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

describe('scanForBadges', () => {
  it('scans a comment block for a markdown image url', () => {
    const text = `<!--badge-compile-->\n![my markdown image](https://link.svg)\n<!--badge-compile-stop-->`
    const result = scanForBadges(text)
    expect(result).toMatchObject(['https://link.svg'])
  })

  it('ignores whitespace in the start/stop comments', () => {
    const text = `\t\t\t   <!--\t badge-compile \t \t-->\t \t \n![my markdown image](https://link.svg)\n\t \t<!-- \t badge-compile-stop \t\t -->\t \t   `
    const result = scanForBadges(text)
    expect(result).toMatchObject(['https://link.svg'])
  })

  it('ignores whitespace in the link', () => {
    const text = `<!--badge-compile-->\n\t \t![my markdown image]( \t https://link.svg\t\t )\n<!--badge-compile-stop-->`
    const result = scanForBadges(text)
    expect(result).toMatchObject(['https://link.svg'])
  })

  it('scans multiple blocks', async () => {
    const text = new Array(10)
      .fill(
        `<!--badge-compile-->\n![my markdown image](https://link.svg)\n<!--badge-compile-stop-->`
      )
      .join('\n')
    const result = scanForBadges(text)
    expect(result).toMatchObject(new Array(10).fill('https://link.svg'))
  })

  it('scans multiple links', () => {
    const text = `<!--badge-compile-->
        ![my markdown image](https://link.svg)
        ![my other markdown image](https://link2.svg)
        ![my markdown image](https://anotherlink.gov)
        <!--badge-compile-stop-->`
    const result = scanForBadges(text)
    expect(result).toMatchObject([
      'https://link.svg',
      'https://link2.svg',
      'https://anotherlink.gov'
    ])
  })

  it('ignores other text around the links', () => {
    const text = `<!--badge-compile-->
    sa dasdas     ![my markdown image](https://link.svg)sad asdas d
    asdaasd    a sd a![my other markdown image](https://link2.svg)asd a
  d asd      ![my markdown image](https://anotherlink.gov)as daswdasd asd
      <!--badge-compile-stop-->`
    const result = scanForBadges(text)
    expect(result).toMatchObject([
      'https://link.svg',
      'https://link2.svg',
      'https://anotherlink.gov'
    ])
  })

  it('scans multiple links in multiple blocks', () => {
    const text = new Array(10)
      .fill(
        `<!--badge-compile-->
        ![my markdown image](https://link.svg)
        ![my other markdown image](https://link2.svg)
        ![my markdown image](https://anotherlink.gov)
        <!--badge-compile-stop-->`
      )
      .join('\n')
    const result = scanForBadges(text)
    expect(result).toMatchObject(
      new Array(10)
        .fill([
          'https://link.svg',
          'https://link2.svg',
          'https://anotherlink.gov'
        ])
        .reduce((acc, val) => acc.concat(val), [])
    )
  })
})

describe('filterBadgeUrls', () => {
  it('returns the list of badge urls', () => {
    const input = ['https://example.com', 'http://google.com']
    const output = filterBadgeUrls(input)
    expect(output).toMatchObject(input)
  })

  it('removes duplicates', () => {
    const input = [
      'https://example.com',
      'http://google.com',
      'http://google.com',
      'https://example.com'
    ]
    const output = filterBadgeUrls(input)
    expect(output).toMatchObject(['https://example.com', 'http://google.com'])
  })

  it('removes invalid URLs', () => {
    const input = ['https://example.com', 'foo', 'http://google.com']
    const output = filterBadgeUrls(input)
    expect(output).toMatchObject(['https://example.com', 'http://google.com'])
  })

  it('removes non-http URLs', () => {
    const input = [
      'https://example.com',
      'ftp://foo',
      'http://google.com',
      'file://folder/a/relative/path'
    ]
    const output = filterBadgeUrls(input)
    expect(output).toMatchObject(['https://example.com', 'http://google.com'])
  })
})

describe('replaceUrls', () => {
  it('replaces an image url', () => {
    const text = '![alt text](image.link)'
    const actual = replaceBadgeUrls(text, [
      {path: '/my/path', url: 'image.link'}
    ])
    expect(actual).toEqual('![alt text](/my/path)')
  })

  it('replaces the same image url twice', () => {
    const text = '![alt text](image.link)\n![more alt text](image.link)'
    const actual = replaceBadgeUrls(text, [
      {path: '/my/path', url: 'image.link'}
    ])
    expect(actual).toEqual('![alt text](/my/path)\n![more alt text](/my/path)')
  })

  it('replaces more than one image', () => {
    const text = '![alt text](image.link)\n![more alt text](image.link.other)'
    const actual = replaceBadgeUrls(text, [
      {path: '/my/path', url: 'image.link'},
      {path: '/my/other/path', url: 'image.link.other'}
    ])
    expect(actual).toEqual(
      '![alt text](/my/path)\n![more alt text](/my/other/path)'
    )
  })

  it('strips whitespace', () => {
    const text = '![  \t alt text\t\t\t](\t \t image.link \t\t )'
    const actual = replaceBadgeUrls(text, [
      {path: '/my/path', url: 'image.link'}
    ])
    expect(actual).toEqual('![  \t alt text\t\t\t](/my/path)')
  })

  it('ignores non-image links', () => {
    const text = '[alt text](image.link)\n![more alt text](image.link)'
    const actual = replaceBadgeUrls(text, [
      {path: '/my/path', url: 'image.link'}
    ])
    expect(actual).toEqual('[alt text](image.link)\n![more alt text](/my/path)')
  })

  it('handles image in link format', () => {
    const text = '[![alt text](image.link)](other.link)'
    const actual = replaceBadgeUrls(text, [
      {path: '/my/path', url: 'image.link'}
    ])
    expect(actual).toEqual('[![alt text](/my/path)](other.link)')
  })
})

describe('fetchAndWriteBadge', () => {
  const svgInPath = path.resolve(__dirname, 'test.svg')
  let svgOutPath: string
  let svgRemove: () => void

  beforeEach(async () => {
    const {dirPath, dirRemove} = await getTempDir()
    svgOutPath = path.join(dirPath, 'image')
    svgRemove = dirRemove
  })

  afterEach(() => svgRemove())

  it('fetches a badge and writes it to a file', async () => {
    const scope = nock('https://example.com')
      .get('/getmeansvg')
      .replyWithFile(200, svgInPath, {'content-type': 'image/svg+xml'})

    const writePath = await fetchAndWriteBadge(
      'https://example.com/getmeansvg',
      svgOutPath
    )

    const expected = await fs.promises.readFile(svgInPath, 'utf8')
    const actual = await fs.promises.readFile(`${svgOutPath}.svg`, 'utf8')
    scope.done()
    expect(writePath).toEqual(`${svgOutPath}.svg`)
    expect(actual).toEqual(expected)
  })

  it('fails if the API throws an error', async () => {
    const scope = nock('https://example.com')
      .get('/getmeansvg')
      .replyWithError('oops')

    const writePath = await fetchAndWriteBadge(
      'https://example.com/getmeansvg',
      svgOutPath
    )

    scope.done()
    expect(writePath).toEqual(null)
  })

  it('fails if the API returns non-200', async () => {
    const scope = nock('https://example.com').get('/getmeansvg').reply(500)

    const writePath = await fetchAndWriteBadge(
      'https://example.com/getmeansvg',
      svgOutPath
    )

    scope.done()
    expect(writePath).toEqual(null)
  })

  it('fails if no content-type header is provided', async () => {
    const scope = nock('https://example.com')
      .get('/getmeansvg')
      .replyWithFile(200, svgInPath)

    const writePath = await fetchAndWriteBadge(
      'https://example.com/getmeansvg',
      svgOutPath
    )

    scope.done()
    expect(writePath).toEqual(null)
  })

  it('uses the correct file extension for other content types', async () => {
    const scope = nock('https://example.com')
      .get('/getmeansvg')
      .replyWithFile(200, svgInPath, {'content-type': 'image/png'})

    const writePath = await fetchAndWriteBadge(
      'https://example.com/getmeansvg',
      svgOutPath
    )

    scope.done()
    expect(writePath).toEqual(`${svgOutPath}.png`)
  })
})

describe('run', () => {
  let outputRemove: () => void
  const svgInPath = path.resolve(__dirname, 'test.svg')

  beforeEach(async () => {
    const {filePath, fileRemove} = await getTempFile()
    outputRemove = fileRemove
    process.env[getInputName(Inputs.CUR_REPO)] = 'testowner/testrepo'
    process.env[getInputName(Inputs.CUR_BRANCH)] = 'refs/head/main'
    process.env[getInputName(Inputs.INPUT_FILE)] = path.resolve(
      __dirname,
      'TEST_INPUT.md'
    )
    process.env[getInputName(Inputs.OUTPUT_MARKDOWN_FILE)] = filePath
    process.env[getInputName(Inputs.OUTPUT_SVG_DIR)] = '__tests__/test-svg-dir'
  })

  afterEach(async () => {
    outputRemove()
    await new Promise((resolve, reject) =>
      rimraf(path.resolve(__dirname, 'test-svg-dir'), e => {
        if (e) reject(e)
        else resolve()
      })
    )
  })

  it('replaces link in a markdown document with a githubusercontent url', async () => {
    const scope = nock('https://img.shields.io')
      .get('/badge/%E2%9C%85-RepolinterAction-black?style=flat-square')
      .replyWithFile(200, svgInPath, {'content-type': 'image/svg+xml'})

    await run()

    const expectedSvg = await fs.promises.readFile(svgInPath, 'utf-8')
    const actual = await fs.promises.readFile(
      process.env[getInputName(Inputs.OUTPUT_MARKDOWN_FILE)] as string,
      'utf-8'
    )
    const actualSvg = await fs.promises.readFile(
      path.resolve(__dirname, 'test-svg-dir', 'badge-0.svg'),
      'utf-8'
    )

    scope.done()
    expect(actual.replace('\r', '')).toEqual(
      `<!-- badge-compile -->\n![alt text](https://raw.githubusercontent.com/testowner/testrepo/main/__tests__/test-svg-dir/badge-0.svg)\n<!-- badge-compile-stop -->\n`
    )
    expect(actualSvg).toEqual(expectedSvg)
    expect(process.exitCode).toBeFalsy()
  })

  it('does nothing if no badges are present', async () => {
    const {filePath, fileRemove} = await getTempFile()
    try {
      process.env[getInputName(Inputs.INPUT_FILE)] = filePath
      await run()
    } finally {
      fileRemove()
    }
    expect(process.exitCode).toBeFalsy()
  })

  it('throws if no input file is supplied', async () => {
    delete process.env[getInputName(Inputs.INPUT_FILE)]

    await run()

    expect(process.exitCode).not.toEqual(0)
  })

  it('throws if no output file is supplied', async () => {
    delete process.env[getInputName(Inputs.OUTPUT_MARKDOWN_FILE)]

    await run()

    expect(process.exitCode).not.toEqual(0)
  })

  it('throws if no output dir is supplied', async () => {
    delete process.env[getInputName(Inputs.OUTPUT_SVG_DIR)]

    await run()

    expect(process.exitCode).not.toEqual(0)
  })

  it('throws if no repo is supplied', async () => {
    delete process.env[getInputName(Inputs.CUR_REPO)]

    await run()

    expect(process.exitCode).not.toEqual(0)
  })

  it('throws if no branch is supplied', async () => {
    delete process.env[getInputName(Inputs.CUR_BRANCH)]

    await run()

    expect(process.exitCode).not.toEqual(0)
  })

  it('throws if an invalid branch is supplied', async () => {
    process.env[getInputName(Inputs.CUR_BRANCH)] = ''

    await run()

    expect(process.exitCode).not.toEqual(0)
  })
})
