import * as core from '@actions/core'
import * as fs from 'fs'
import {promisify} from 'util'
import {pipeline} from 'stream'
import fetch from 'node-fetch'
import * as path from 'path'
import * as mime from 'mime-types'
import * as urlLib from 'url'

const StreamPipeline = promisify(pipeline)

export const enum Inputs {
  INPUT_FILE = 'input_markdown_file',
  OUTPUT_MARKDOWN_FILE = 'output_markdown_file',
  OUTPUT_IMG_DIR = 'output_image_dir',
  CUR_REPO = 'current_repository',
  CUR_BRANCH = 'current_branch',
  USE_CDN = 'cdn'
}

// An Electron 2.0 running on Linux, so shields.io doesn't block us
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Cypress/3.4.1 Chrome/61.0.3163.100 Electron/2.0.18 Safari/537.36'

/**
 * Scans a markdown document for blocks denotated by a specific markdown comment
 * (<!-- badge-compile -->) and extracts all markdown image links from that
 * block (looking for ![](url) syntax). An example block is as follows:
 * ```markdown
 * ...
 * <!-- badge-compile -->
 * ...
 * ![my image](https://capture-this-url.com)
 * ...
 * <!-- badge-compile-stop -->
 * ...
 * ```
 * The above input in the following output: ['https://capture-this-url.com']
 *
 * @param input The markdown string to parse for URLs
 * @returns An array of URLs found in the document.
 */
export function scanForBadges(input: string): string[] {
  const COMMENT_SCAN = /<!--\s*badge-compile\s*-->\s*$\s*([^<]+)\s*^\s*<!--\s*badge-compile-stop\s*-->/gim
  const LINK_SCAN = /!\[[^\]]+]\(\s*([^\s)]+)\s*\)/g
  // get blocks where the start/end comment tag indicate we should compile the badges
  const compileBlocks = [...input.matchAll(COMMENT_SCAN)]
    .map(m => m[1])
    .filter(b => b)
  // get all markdown image urls from the links
  return compileBlocks
    .map(b => [...b.matchAll(LINK_SCAN)])
    .flat()
    .map(l => l[1])
    .filter(l => l)
}

/**
 * Filters a list of URLs by removing duplicates, removing invalid URLs,
 * and restricting the protocol type to http or https. This filter
 * is designed to remove non-image URLs and dupes.
 *
 * @param urls A list of unfiltered URLs to filter
 * @returns A filtered list of valid badge URLs
 */
export function filterBadgeUrls(urls: string[]): string[] {
  // deduplicate that array (neat little algorithm)
  const deDupedBadges = [...new Set(urls)]
  // remove all invalid or non-http links
  return deDupedBadges.filter(b => {
    try {
      const badgeUrl = new urlLib.URL(b)
      if (badgeUrl.protocol.startsWith('http') === false) {
        core.warning(`Ignoring non-web badge URL ${b}`)
        return false
      }
    } catch {
      core.warning(`Ignoring invalid badge URL ${b}`)
      return false
    }
    return true
  })
}

/**
 * Replace all instances of a markdown image URL (ex. ![](image.png))
 * with a respective file path. Also strips whitespace from the beginning
 * and end of the URL.
 *
 * @param input The string to replace
 * @param urls The list of URLs and thier associated paths
 * @returns The string with replacements made
 */
export function replaceBadgeUrls(
  input: string,
  urls: Array<{path: string; url: string}>
): string {
  const LINK_SCAN = /!\[([^\]]+)]\(\s*([^\s)]+)\s*\)/g
  // convert the urls array into a dictionary
  const dict = new Map(urls.map(u => [u.url, u.path]))
  // search for markdown image links
  return input.replace(LINK_SCAN, (_m, alt, url) =>
    dict.has(url) ? `![${alt}](${dict.get(url)})` : `![${alt}](${url})`
  )
}

/**
 * Fetch an arbitrary image and write it to a file. Automagically
 * determines the file extension from the content-type header.
 *
 * @param url The URL to fetch the image from.
 * @param filepath The filepath to write the image too, minus the extention
 * @returns the full path of the fetched file
 */
export async function fetchAndWriteBadge(
  url: string,
  filepath: string
): Promise<string | null> {
  let res
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    })
  } catch (e) {
    core.warning(`Fetching badge ${url} failed with error ${e.toString()}`)
    return null
  }
  // more error checks
  if (!res.ok || !res.headers.get('content-type')) {
    if (!res.ok)
      core.warning(
        `Fetching badge ${url} failed with status code ${res.status}: ${res.statusText}`
      )
    else core.warning(`Recieved no content-type header from badge ${url}`)
    return null
  }
  // looks like we're good! write the file
  const filePathExtension = `${filepath}.${mime.extension(
    res.headers.get('content-type') as string
  )}`
  await StreamPipeline(res.body, fs.createWriteStream(filePathExtension))
  return filePathExtension
}

export default async function run(): Promise<void> {
  try {
    // get inputs
    const inputFile = core.getInput(Inputs.INPUT_FILE, {required: true})
    const outputFile = core.getInput(Inputs.OUTPUT_MARKDOWN_FILE, {
      required: true
    })
    const outputSvgDir = core.getInput(Inputs.OUTPUT_IMG_DIR, {required: true})
    const repo = core.getInput(Inputs.CUR_REPO, {required: true})
    const ref = core.getInput(Inputs.CUR_BRANCH, {required: true})
    const cdn = String(core.getInput(Inputs.USE_CDN))
    let domain = 'raw.githack.com'
    if (cdn.toLowerCase() == 'true') {
      domain = 'rawcdn.githack.com'
    }
    const branch = ref.split('/').pop()
    if (!branch) throw new Error(`Could not parse supplied ref "${ref}"`)
    // generate the base URL where all realative paths will be joined with
    const urlBase = `https://${domain}/${repo}/${branch}/`
    // read the input file
    const input = await fs.promises.readFile(inputFile, 'utf-8')
    // scan it for relavant links
    const badges = scanForBadges(input)
    const validBadges = filterBadgeUrls(badges)
    // print debugging info
    if (!validBadges.length) {
      core.warning("Didn't find any badges to replace!")
      return
    }
    core.info('Found badge URLs to replace:')
    for (const b of validBadges) core.info(`\t- ${b}`)
    // create the SVG output directory
    await fs.promises.mkdir(outputSvgDir, {recursive: true})
    // fetch each badge
    const paths = await Promise.all(
      validBadges.map(async (b, i) =>
        fetchAndWriteBadge(b, path.join(outputSvgDir, `badge-${i}`))
      )
    )
    // zip the arrays and filter out null paths
    const inputPathsAndUrls = validBadges
      .filter((d, i) => paths[i] !== null)
      .map((d, i) => {
        return {url: d, path: urlLib.resolve(urlBase, paths[i] as string)}
      })
    // replace all instances of each badge url with the new path
    const output = replaceBadgeUrls(
      input,
      inputPathsAndUrls as Array<{path: string; url: string}>
    )
    // write the output to file
    await fs.promises.writeFile(outputFile, output)
  } catch (error) {
    core.error('A fatal error occured: ')
    core.setFailed(error.toString())
  }
}
