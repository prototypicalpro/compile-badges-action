import * as core from '@actions/core'
import * as fs from 'fs'
import {promisify} from 'util'
import {pipeline} from 'stream'
import fetch from 'node-fetch'
import * as path from 'path'
import * as mime from 'mime-types'
import {URL} from 'url'

const StreamPipeline = promisify(pipeline)

const enum Inputs {
  INPUT_FILE = 'input_markdown_file',
  OUTPUT_MARKDOWN_FILE = 'output_markdown_file',
  OUTPUT_SVG_DIR = 'output_svg_dir'
}

/**
 * Fetch an arbitrary image and write it to a file. Automagically
 * determines the file extension from the content-type header.
 * @param url The URL to fetch the image from.
 * @param filepath The filepath to write the image too, minus the extention
 * @returns the full path of the fetched file
 */
async function fetchAndWriteBadge(
  url: string,
  filepath: string
): Promise<string | null> {
  const res = await fetch(url)
  if (!res.ok || !res.headers.get('content-type')) {
    core.warning(
      `Fetching badge ${url} failed with status code ${res.status}: ${res.statusText}`
    )
    return null
  }
  const filePathExtension = `${filepath}.${mime.extension(
    res.headers.get('content-type') as string
  )}`
  await StreamPipeline(res.body, fs.createWriteStream(filePathExtension))
  return filePathExtension
}

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
 * Replace all instances of a markdown image URL (ex. ![](image.png))
 * with a respective file path.
 * @param input The string to replace
 * @param urls The list of URLs and thier associated paths
 * @returns The string with replacements made
 */
export function replaceUrls(
  input: string,
  urls: {path: string; url: string}[]
): string {
  const LINK_SCAN = /!\[([^\]]+)]\(\s*([^\s)]+)\s*\)/g
  // convert the urls array into a dictionary
  const dict = new Map(urls.map(u => [u.url, u.path]))
  // search for markdown image links
  return input.replace(LINK_SCAN, (_m, alt, url) =>
    dict.has(url) ? `![${alt}](${dict.get(url)})` : `![${alt}](${url})`
  )
}

export default async function run(): Promise<void> {
  try {
    // get inputs
    const inputFile = core.getInput(Inputs.INPUT_FILE, {required: true})
    const outputFile = core.getInput(Inputs.OUTPUT_MARKDOWN_FILE, {
      required: true
    })
    const outputSvgDir = core.getInput(Inputs.OUTPUT_SVG_DIR, {required: true})
    // create the SVG output directory
    await fs.promises.mkdir(outputSvgDir, {recursive: true})
    // read the input file
    const input = await fs.promises.readFile(inputFile, 'utf-8')
    // scan it for relavant links
    const badges = scanForBadges(input)
    // deduplicate that array (neat little algorithm)
    const deDupedBadges = [...new Set(badges)]
    // remove all invalid or non-http links
    const validBadges = deDupedBadges.filter(b => {
      try {
        const url = new URL(b)
        if (url.protocol.startsWith('http') === false) {
          core.warning(`Ignoring non-web badge URL ${b}`)
          return false
        }
      } catch {
        core.warning(`Ignoring invalid badge URL ${b}`)
        return false
      }
      return true
    })
    // print debugging info
    if (!validBadges.length) {
      core.warning("Didn't find any badges to replace!")
      return
    }
    core.info('Found badge URLs to replace:')
    for (const b of validBadges) core.info(`\t- ${b}`)
    // fetch each badge
    const paths = await Promise.all(
      validBadges.map(async (b, i) =>
        fetchAndWriteBadge(b, path.join(outputSvgDir, `badge-${i}`))
      )
    )
    // zip the arrays and filter out null paths
    const inputPathsAndUrls = deDupedBadges
      .map((d, i) => {
        return {url: d, path: paths[i]}
      })
      .filter(o => o.path !== null)
    // replace all instances of each badge url with the new path
    const output = replaceUrls(
      input,
      inputPathsAndUrls as {path: string; url: string}[]
    )
    // write the output to file
    await fs.promises.writeFile(outputFile, output)
  } catch (error) {
    core.error('A fatal error occured: ')
    core.setFailed(error.toString())
  }
}
