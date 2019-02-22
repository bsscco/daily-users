console.log(new Date().toTimeString());

const fs = require('fs');
const config = JSON.parse(fs.readFileSync(__dirname + '/config.json'));
const queries = require('./db-queries');

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const moment = require('moment');
const numberFormat = require('number-formatter');

const serviceAccount = require(__dirname + "/firebase-service-account.json");
const firebase = require('firebase-admin');

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://ohouse-android.firebaseio.com"
});

const pgp = require('pg-promise')();

const app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.status(200).send('Hello, DailyUsers!').end();
});

app.post('/users', (req, res) => {
    console.log(req.body);
    res.send('');

    if (req.body.text === 'goal') {
        getDbUsers()
            .then(snapshot => openDlg(req.body.trigger_id, makeGoalSettingDlgPayload(snapshot.val())))
            .then(res => console.log(res.data))
            .catch(err => console.log(err));
    }
});

app.post('/interact', (req, res) => {
    console.log(req.body);
    res.send('');

    const body = JSON.parse(req.body.payload);
    if (body.callback_id === 'save_goal') {
        const date = moment({y: Number(body.submission.year), M: Number(body.submission.month) - 1}).format('YYYY-MM');

        saveGoalData(date, body.submission.goal)
            .then(res => sendMsg(body.response_url, makeGoalSavedMsgPayload(date, body.submission.goal)))
            .then(res => console.log(res.data))
            .catch(err => console.log(err));
    }
});

app.get('/notify/yesterday/users', (req, res) => {
    res.sendStatus(200);

    const today = moment();
    const yesterday = moment(today).subtract(1, 'days');
    // const today = moment({y: 2018, M: Number(process.argv[2]), d: date}).add(1, 'days');
    const dates = {
        today,
        yesterday,
        lastWeekToday: moment(today).subtract(7, 'days'),
        lastWeekYesterday: moment(yesterday).subtract(7, 'days'),
    }
    const signInCnts = {
        yesterday: 0,
        lastWeekYesterday: 0,
        thisWeek: 0,
        lastWeek: 0,
        lastWeekRemained: 0,
        thisMonth: 0,
        lastMonth: 0,
        thisMonthGoal: 0,
    }
    const db = pgp({
        host: config.db.host,
        port: config.db.port,
        database: config.db.name,
        user: config.db.user,
        password: config.db.pwd
    });
    getDbUsers(yesterday.format('YYYY-MM'))
        .then(snapshot => {
            signInCnts.thisMonthGoal = parseInt(snapshot.val().goal);
            return db.any(queries.getSignInCnt(dates.yesterday, dates.today));
        })
        .then((rows) => {
            signInCnts.yesterday = rows[0].cnt;
            return db.any(queries.getSignInCnt(dates.lastWeekYesterday, dates.lastWeekToday));
        })
        .then((rows) => {
            signInCnts.lastWeekYesterday = rows[0].cnt;
            return db.any(queries.getSignInCnt(moment(dates.yesterday).startOf('week'), dates.today));
        })
        .then((rows) => {
            signInCnts.thisWeek = rows[0].cnt;
            return db.any(queries.getSignInCnt(moment(dates.lastWeekYesterday).startOf('week'), dates.lastWeekToday));
        })
        .then((rows) => {
            signInCnts.lastWeek = rows[0].cnt;
            return db.any(queries.getSignInCnt(moment(dates.lastWeekToday), moment(dates.yesterday).startOf('week')));
        })
        .then((rows) => {
            signInCnts.lastWeekRemained = rows[0].cnt;
            return db.any(queries.getSignInCnt(moment(dates.yesterday).startOf('month'), dates.today));
        })
        .then((rows) => {
            signInCnts.thisMonth = rows[0].cnt;
            return db.any(queries.getSignInCnt(moment(dates.yesterday).subtract(1, 'months').startOf('month'), moment(yesterday).subtract(1, 'months').set('date', today.get('date'))));
        })
        .then((rows) => signInCnts.lastMonth = rows[0].cnt)
        .then(() => sendMsg('', makeNotiMsgPayload(dates, signInCnts)))
        .then(res => console.log(res.data))
        .catch((e) => console.log(e.message));
});

function getDbUsers(date) {
    let path = '/daily-users';
    if (date) {
        path += '/' + date;
    }
    return firebase.database().ref(path).once('value');
}

function saveGoalData(date, goal) {
    return firebase.database().ref('/daily-users/' + date).update({goal: goal});
}

function makeGoalSettingDlgPayload(monthlyGoals) {
    const elements = [];

    let monthlyGoalsText = '';
    for (const date in monthlyGoals) {
        monthlyGoalsText += date + ' : ' + monthlyGoals[date].goal + '명\n';
    }
    elements.push({
        type: 'textarea',
        label: '설정된 목표들(참고용)',
        name: 'none',
        hint: '참고용입니다. 여기서 수정해도 저장되지 않습니다.',
        value: monthlyGoalsText,
        optional: true
    });

    const years = [];
    for (let y = 2019; y <= moment().year() + 1; y++) {
        years.push({label: '' + y, value: '' + y});
    }
    elements.push({
        type: 'select',
        label: '년',
        name: 'year',
        value: '' + moment().year(),
        options: years,
        subtype: 'number',
        optional: false,
    });

    const months = [];
    for (let m = 1; m <= 12; m++) {
        months.push({label: '' + m, value: '' + m});
    }
    elements.push({
        type: 'select',
        label: '월',
        name: 'month',
        value: '' + (moment().month() + 1),
        options: months,
        subtype: 'number',
        optional: false
    });

    elements.push({
        type: 'text',
        label: '사용자수 목표',
        name: 'goal',
        placeholder: 'ex) 2000000',
        value: '',
        subtype: 'number',
        optional: false
    });

    return {
        callback_id: 'save_goal',
        title: '접속 사용자수 목표 설정',
        submit_label: '저장',
        elements: elements
    };
}

function makeGoalSavedMsgPayload(date, goal) {
    return {
        attachments: [
            {
                title: date + ' 설정된 목표',
                text: goal + '명',
                color: '#35c5f0'
            }
        ]
    };
}

function makeNotiMsgPayload(dates, signInCnts) {
    const yesterdayIncrRate = (signInCnts.yesterday - signInCnts.lastWeekYesterday) / signInCnts.lastWeekYesterday * 100;
    // const thisWeekIncrRate = (signInCnts.thisWeek - signInCnts.lastWeek) / signInCnts.lastWeek * 100;
    const thisMonthIncrRate = (signInCnts.thisMonth - signInCnts.lastMonth) / signInCnts.lastMonth * 100;
    let thisMonthExpected = 0;
    if (dates.yesterday.date() < 7) {
        thisMonthExpected = (signInCnts.thisWeek + signInCnts.lastWeekRemained) / 7 * dates.yesterday.daysInMonth();
    } else {
        thisMonthExpected = signInCnts.thisMonth / dates.yesterday.date() * dates.yesterday.daysInMonth();
    }
    thisMonthExpected = Math.round(thisMonthExpected);

    const json = {
        channel: config.slack.noti_channel_id,
        attachments: [
            {
                title: '일간',
                color: '#35c5f0',
                id: 1,
                text: '',
                fields: [
                    {
                        title: dates.yesterday.format('MM/DD(ddd)') + ' 어제',
                        value: numberFormat('#,##0.', signInCnts.yesterday) + '명 (지난 주 대비 ' + (yesterdayIncrRate >= 0 ? '▲' : '▼') + numberFormat('#,##0.##%', Math.abs(yesterdayIncrRate)) + ')',
                        short: true
                    }
                ]
            },
            // {
            //     title: '주간',
            //     color: '#35c5f0',
            //     id: 2,
            //     text: '',
            //     fields: [
            //         {
            //             title: moment(dates.yesterday).startOf('week').format('MM/DD(ddd)') + ' ~ 어제까지',
            //             value: numberFormat('#,##0.', signInCnts.thisWeek) + '명 (지난 주 대비 ' + (thisWeekIncrRate >= 0 ? '▲' : '▼') + numberFormat('#,##0.##%', Math.abs(thisWeekIncrRate)) + ')',
            //             short: false
            //         }
            //     ]
            // },
            {
                title: '월간',
                color: '#35c5f0',
                id: 3,
                text: '',
                fields: [
                    {
                        title: moment(dates.yesterday).startOf('month').format('MM/DD(ddd)') + ' ~ 어제까지',
                        value: numberFormat('#,##0.', signInCnts.thisMonth) + '명 (지난 월 대비 ' + (thisMonthIncrRate >= 0 ? '▲' : '▼') + numberFormat('#,##0.##%', Math.abs(thisMonthIncrRate)) + ')',
                        short: true
                    },
                    {
                        title: dates.yesterday.format('MM월') + ' 예상',
                        value: numberFormat('#,##0.', thisMonthExpected) + '명 (목표 ' + numberFormat('#,##0.', signInCnts.thisMonthGoal) + '명)\n*`' + numberFormat('#,##0.', Math.abs(signInCnts.thisMonthGoal - thisMonthExpected)) + '명' + (signInCnts.thisMonthGoal - thisMonthExpected >= 0 ? ' 더 필요' : ' 초과달성') + '`*',
                        short: true
                    }
                ]
            }
        ]
    };

    return json;
}

function openDlg(triggerId, payload) {
    return axios.post('https://slack.com/api/dialog.open', JSON.stringify({
            trigger_id: triggerId,
            dialog: JSON.stringify(payload)
        }),
        {
            headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + config.slack.bot_access_token}
        }
    );
}

function sendMsg(responseUrl, payload) {
    return axios.post(responseUrl ? responseUrl : 'https://slack.com/api/chat.postMessage', JSON.stringify(payload), {
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + config.slack.bot_access_token
        }
    });
}


// Start the server
const PORT = process.env.PORT || 14000;
app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});