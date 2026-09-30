#!/usr/bin/env python3
"""Compatibility entry point. Prefer npm run deploy; see docs/deployment.md."""
from azure_deploy import main

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyboardInterrupt) as error:
        raise SystemExit(str(error) or 'Deployment interrupted.')
