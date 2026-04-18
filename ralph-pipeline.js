#!/usr/bin/env node

import { runPipelineCommand } from './lib/pipeline-cli.js';

runPipelineCommand(process.argv.slice(2));
