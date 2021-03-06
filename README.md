# Compile Badges Action v1

[![GitHub Marketplace version](https://img.shields.io/github/release/prototypicalpro/compile-badges-action.svg?label=Marketplace&logo=github)](https://github.com/marketplace/actions/compile-badges-action)
![Build/Test](https://github.com/prototypicalpro/compile-badges-action/workflows/Build/Test/badge.svg?event=push)
[![codecov](https://codecov.io/gh/prototypicalpro/compile-badges-action/branch/main/graph/badge.svg)](https://codecov.io/gh/prototypicalpro/compile-badges-action)
[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/prototypicalpro/compile-badges-action.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/prototypicalpro/compile-badges-action/context:javascript)
![Pixel Tracker](https://track.prototypical.pro?source=github&repo=compile-badges-action)

This action converts README badges into local copies in the repository. The goal of this action is to reduce bandwidth usage of shields.io for badge-heavy GitHub profile READMEs such as [this one](https://github.com/prototypicalpro/prototypicalpro).

## Usage

You can use `<!-- badge-compile -->` and `<!-- badge-compile-stop -->` tags to indicate which badges should be compiled in your `README`:
```markdown
...
<!-- badge-compile -->
![a badge](https://my-badge.com)
[![another badge with a link](https://my-other-badge.com)](https://my-project.com)
<!-- badge-compile-stop -->
...
```
Once these tags are in place, add the following workflow file to your `.github/workflows` folder:
```yaml

name: 'Compile Badges'

on:
  push:
    branches:
      - master

jobs:
  repolinter-action:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v2
      - name: Compile Badges
        uses: prototypicalpro/compile-badges@v1
        with:
          input_markdown_file: README.md
          output_markdown_file: README-compiled.md
      - name: Push To Master
        uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: Compile README [skip ci]
          file_pattern: README-compiled.md readme/*

```
This workflow will then download and save each badge to a `readme` folder in the current repository. Once this is complete, the action will replace the badge URLs in the README with ones pointing to githubusercontent.com. Finally, this workflow will use [stefanzweifel/git-auto-commit-action](https://github.com/stefanzweifel/git-auto-commit-action) to commit the new markdown file and downloaded badges to the current branch. Note that this action only modifies the local filesystem, and it is up to the workflow creator to ensure the changes end up in source control.

 The final result is a `README-compiled.md` file that looks like so:
```markdown
...
<!-- badge-compile -->
![a badge](https://raw.githubusercontent.com/<user>/<repo>/<branch>/readme/badge-0.svg)
[![another badge with a link](https://raw.githubusercontent.com/<user>/<repo>/<branch>/readme/badge-1.svg)](https://my-project.com)
<!-- badge-compile-stop -->
...
```
And you're all set!

### Usage With a Custom CDN

If you would like to use a custom CDN instead of `githubusercontent` (such as [githack](https://raw.githack.com/)), you can use the `badge_url_template` input to adjust how badge URLs are compiled:

```yaml
# ...
- name: Compile Badges
  uses: prototypicalpro/compile-badges@v1
  with:
    input_markdown_file: README.md
    output_markdown_file: README-compiled.md
    badge_url_template: https://raw.githack.com/{repo}/{branch}/{path}/{badge}
# ...
```

The above settings will generate the following markdown output:

```md
<!-- badge-compile -->
![a badge](https://raw.githack.com/<user>/<repo>/<branch>/readme/badge-0.svg)
[![another badge with a link](https://raw.githack.com/<user>/<repo>/<branch>/readme/badge-1.svg)](https://my-project.com)
<!-- badge-compile-stop -->
```

More information about this property can be found in the [Configuration](#configuration) documentation below.

## Configuration

This action takes the following inputs:
```yaml
- uses: prototypicalpro/compile-badges-action@v1
  with:
    # The markdown file to load and parse for badges.
    #
    # Default: README.md
    input_markdown_file: ''

    # The markdown file to write when parsing and replacing is complete.
    #
    # Default: README.md
    output_markdown_file: ''

    # The directory to write all the fetched badge images to. Due to how
    # the content URLs are generated, this path must be relative and
    # contained in the current repository.
    #
    # Default: readme
    output_image_dir: ''

    # The current repository in owner/name format. This value is used to
    # generate URLs to raw.githubusercontent.com from a relative path in
    # the repository. It is recommended this be left as the default value.
    #
    # Default: ${{ github.repository }}
    output_image_dir: ''

    # The current branch/ref in github.ref format. This value is used to
    # generate URLs to raw.githubusercontent.com from a relative path in
    # the repository. It is recommended this be left as the default value.
    #
    # Default: ${{ github.ref }}
    current_branch: ''

    # The template string used to generate URLs to the compiled badges.
    # You can use this field to adjust which CDN this action should
    # compile for (ex. githack instead of githubusercontent).
    #
    # This template is populated using the string-template library
    # (https://www.npmjs.com/package/string-template) with the following
    # available varibles:
    # - `repo`: The string from the `current_repository` input.
    # - `branch`: The branch name parsed from the `current_branch` input.
    # - `path`: The path supplied by `ouput_image_dir` where badges
    #    are being stored. This path is automatically stripped of trailing
    #    slashes.
    # - `badge`: The filename of the compiled badge output.
    #
    # Default: https://raw.githubusercontent.com/{repo}/{branch}/{path}/{badge}
    badge_url_template: ''
```

## Example

This action is used to compile badges on my personal [GitHub profile README](https://github.com/prototypicalpro/prototypicalpro).
