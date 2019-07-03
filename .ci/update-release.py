#!/usr/bin/env python3

import pathlib
import util

from github.util import GitHubRepositoryHelper

OUTPUT_FILE_NAME='build-result'
VERSION_FILE_NAME='VERSION'

repo_owner_and_name = util.check_env('SOURCE_GITHUB_REPO_OWNER_AND_NAME')
repo_dir = util.check_env('MAIN_REPO_DIR')
output_dir = util.check_env('OUT_PATH')

repo_owner, repo_name = repo_owner_and_name.split('/')

repo_path = pathlib.Path(repo_dir).resolve()
output_path = pathlib.Path(output_dir).resolve()
output_file_path = output_path / OUTPUT_FILE_NAME
version_file_path = repo_path / VERSION_FILE_NAME

version_file_contents = version_file_path.read_text()

cfg_factory = util.ctx().cfg_factory()
github_cfg = cfg_factory.github('github_com')

github_repo_helper = GitHubRepositoryHelper(
    owner=repo_owner,
    name=repo_name,
    github_cfg=github_cfg,
)

gh_release = github_repo_helper.repository.release_from_tag(version_file_contents)

gh_release.upload_asset(
    content_type='application/zip',
    name=f'vscode-gardener-tools-{version_file_contents}.vsix',
    asset=output_file_path.open(mode='rb'),
)
