import {scanForBadges, replaceUrls} from '../src/main'

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

describe('replaceUrls', () => {
  it('replaces an image url', () => {
    const text = '![alt text](image.link)'
    const actual = replaceUrls(text, [{path: '/my/path', url: 'image.link'}])
    expect(actual).toEqual('![alt text](/my/path)')
  })
})
