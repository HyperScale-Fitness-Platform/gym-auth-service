#!/bin/sh
set -e

npm run migrate
exec npm start
