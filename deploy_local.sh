#!/bin/sh

targetPath=./
serviceName="midi-to-xr18"

pm2 delete $serviceName

cd $targetPath

pm2 --name $serviceName --watch $targetPath start "node src/index.js"
