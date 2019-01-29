daemon=`netstat -tlnp | grep :::14000 | wc -l`
if [ "$daemon" -eq "0" ] ; then
        nohup node /home/bsscco/daily-users/app.js &
fi