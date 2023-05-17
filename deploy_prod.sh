#!/bin/sh

oldpath=`pwd`
targetPath=/usr/local/src/midi-to-xr18
serviceName="midi-to-xr18"

pm2 delete $serviceName

cd $targetPath

git fetch
git reset --hard origin/master

if [ "--full" -eq "$1" ]; then
	rm -rf node_modules;
	npm install;
fi

pm2 --name $serviceName --watch $targetPath start "node src/index.js"

cd $oldpath