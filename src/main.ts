#!/usr/bin/env node
import { launch } from "./launch.js";

const code = await launch({ argv: process.argv, env: process.env });
process.exit(code);
