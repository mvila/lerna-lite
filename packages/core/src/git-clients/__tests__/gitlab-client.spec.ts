'use strict';

jest.mock('../GitLabClient');

import { GitLabClient } from '../GitLabClient';
import { createGitLabClient } from '../index';

describe('createGitLabClient', () => {
  const oldEnv = Object.assign({}, process.env);
  delete process.env.GH_TOKEN;

  afterEach(() => {
    process.env = oldEnv;
  });

  it('errors if no GL_TOKEN env var', () => {
    expect(() => {
      createGitLabClient();
    }).toThrow('A GL_TOKEN environment variable is required.');
  });

  it('doesnt error if GL_TOKEN env var is set', () => {
    process.env.GL_TOKEN = 'TOKEN';

    expect(() => {
      createGitLabClient();
    }).not.toThrow();
  });

  it('sets client `baseUrl` when GL_API_URL is set', () => {
    process.env.GL_TOKEN = 'TOKEN';
    process.env.GL_API_URL = 'http://some/host';

    createGitLabClient();

    expect(GitLabClient).toHaveBeenCalledWith('http://some/host', 'TOKEN');
  });

  it('has a createRelease method like ocktokit', () => {
    expect(createGitLabClient().repos.createRelease).toBeInstanceOf(Function);
  });
});
