
const mydaco = require('mydaco');

exports.main = async function main(params) {
    try {
        if (params.inter === 'ServiceMarketplace') {
            if (params.func === 'start') {
                return await start(params.params);
            }
            if (params.func === 'interact') {
                return await interact(params.params);
            }
        }
        if (params.inter === 'IotCore') {

            if (params.params.event === 'click') {
                let placeOccupied = await mydaco.interface('KeyValueStore', 'get', { key: 'occupied' });
                //console.log(await mydaco.interface('Mail', 'sendMail', { text: JSON.stringify(params) + JSON.stringify(placeOccupied) }));
                await setOccupancy(!placeOccupied.value);
            }
            if (params.params.event === 'motion') {
                //await mydaco.interface('Mail', 'sendMail', { text: JSON.stringify(params) });
                await mydaco.interface('KeyValueStore', 'put', { key: 'last_motion', value: Date.now() });
                let placeOccupied = await mydaco.interface('KeyValueStore', 'get', { key: 'occupied' });
                if (!placeOccupied.value) {
                    await mydaco.interface('Mail', 'sendMail', {
                        subject: 'Motion detected!',
                        text: "Hi, we detected that there was motion while you are on holiday - are you back? Please confirm by pressing your button."
                    });
                }
            }
        }
        if (params.inter === 'Cron') {
            let lastMotion = await mydaco.interface('KeyValueStore', 'get', { key: 'last_motion' });
            let placeOccupied = await mydaco.interface('KeyValueStore', 'get', { key: 'occupied' });
            if (Date.now() - lastMotion.value > 60000 && placeOccupied.value) {
                console.log("no motion for long time");
                await mydaco.interface('Mail', 'sendMail', { 
                    subject: 'Are you still home?', 
                    text: 'No movement detected for 24 hours - setting state to away.' 
                });
                await setOccupancy(false);
            }
        }
        if (params.inter === 'Widget') {
            return widgetMain(params);
        }
    } catch (e) {
        console.log(e)
    }
}

async function setOccupancy(occupied) {
    await mydaco.interface('KeyValueStore', 'put', { key: 'occupied', value: occupied });
    //await mydaco.interface('Mail', 'sendMail', { subject: 'set occupancy, occupied:' + occupied });
    if (occupied != true) {
        //turn lights off
        let lamp_id = await mydaco.interface('KeyValueStore', 'get', { key: 'lamp_id' });
        await mydaco.interface('IotCore', 'actuate', { deviceId: lamp_id.value, property: 'on_off', value: 0 });
        //lock door
        let lock_id = await mydaco.interface('KeyValueStore', 'get', { key: 'lock_id' });
        await mydaco.interface('IotCore', 'actuate', { deviceId: lock_id.value, property: 'locked', value: 1 });
        await mydaco.interface('IotCore', 'actuate', { deviceId: lock_id.value, property: 'locked', value: true });
    }
}

async function start(params) {
    const { lang = 'en' } = params;
    const devices = await getAllDevices();
    title = 'Mo-money-less-problems Button';
    text = 'Select what devices to connect:<br>';
    html = 'Which button should toggle the vacation state?<br>';
    for (const d of devices.buttons) {
        html += `<input type="checkbox" name="${d.id}" value="BUTTON" required> ${d.name}<br>`;
    }
    html += 'Which motion sensor should be used to detect motion?<br>';
    for (const d of devices.motions) {
        html += `<input type="checkbox" name="${d.id}" value="MOTION" required> ${d.name}<br>`;
    }
    html += 'Which doors do you want to be controlled?<br>';
    for (const d of devices.locks) {
        html += `<input type="checkbox" name="${d.id}" value="DOORLOCK" required> ${d.name}<br>`;
    }
    html += 'Which speaker do you want to use to play sounds?<br>';
    for (const d of devices.audios) {
        html += `<input type="checkbox" name="${d.id}" value="AUDIO" required> ${d.name}<br>`;
    }
    html += 'Which contact sensor do you want to be monitored?<br>';
    for (const d of devices.contacts) {
        html += `<input type="checkbox" name="${d.id}" value="CONTACT" required> ${d.name}<br>`;
    }
    html += 'Which lamps do you want to be switched off when leaving?<br>';
    for (const d of devices.lamps) {
        html += `<input type="checkbox" name="${d.id}" value="LAMP" required> ${d.name}<br>`;
    }
    html += `<input type="button" onclick="sendInputs()" value="Set me up!" />`;
    return { title, html };
}

async function interact(params) {
    console.log(params.inputs);
    const message = await deleteOldTasks();

    //init subscriptions
    for (var id in params.inputs) {
        switch (params.inputs[id]) {
            case "BUTTON":
                await mydaco.interface('IotCore', 'createEvent', { event: 'click', deviceId: id });
                break;
            case "CONTACT":
                await mydaco.interface('IotCore', 'createEvent', { event: 'contact', deviceId: id });
                break;
            case "MOTION":
                await mydaco.interface('IotCore', 'createEvent', { event: 'motion', deviceId: id });
                break;
            case "LAMP":
                await mydaco.interface('KeyValueStore', 'put', { key: 'lamp_id', value: id });
                break;
            case "DOORLOCK":
                await mydaco.interface('KeyValueStore', 'put', { key: 'lock_id', value: id });
                break;
        }
    }

    console.log(await mydaco.interface('KeyValueStore', 'get', { key: 'lamp_id' }));

    //init occupation
    await setOccupancy(true);

    //init motion
    await mydaco.interface('KeyValueStore', 'put', { key: 'last_motion', value: Date.now() });
    mydaco.interface('Cron', 'put', { cronPatterns: ['* * * * *'] });

    return { html: `The service is configured. Deleted ${message.length} old events.` };
}

//get all devices in the user's account
async function getAllDevices() {
    const devices = await mydaco.interface('IotCore', 'featuredDevices', { type: [] });
    const buttons = devices.filter(device => device.type === 'BUTTON');
    const motions = devices.filter(device => device.type === 'MOTION');
    const locks = devices.filter(device => device.type === 'DOORLOCK');
    const audios = devices.filter(device => device.type === 'AUDIO');
    const contacts = devices.filter(device => device.type === 'CONTACT');
    const lamps = devices.filter(device => device.type === 'LAMP');
    return { motions, buttons, locks, audios, contacts, lamps };
}

async function deleteOldTasks() {
    const events = await mydaco.interface('IotCore', 'listEvents', {});
    for (const event of events) {
        await mydaco.interface('IotCore', 'deleteEvent', { task: event.task });
    }
    return events;
}

async function widgetMain(params) {
    let html, subTitle;

    const placeOccupied = await mydaco.interface('KeyValueStore', 'get', { key: 'occupied' });
    // debug (set mocked data)
    console.log(placeOccupied.value);

    subTitle = 'start';
    html = '<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">';
    if (placeOccupied.value) {
        html += '<i class="material-icons">home</i>';
    } else {
        html += '<i class="material-icons">beach_access</i>';
    }
    return { html, subTitle };
}