ZTE-SMS is a Node package that exposes SMS functions of the ZTE LTE modem. 

Tested with model `MF79U`.

## Install
```bash
npm install @ziga-sebenik/zte-sms
```

## Constructor

```js
new Modem({ modemIP: 'IP', modemPassword: 'password'});
```
`modemIp [string]` - ZTE modem IP address (defaults to `192.168.0.1`)
`modemPassword [string]` - password for ZTE modem

## Methods

- #### `getAllSms()`
Retrieves all SMS messages from modem. This array includes sent, received, unread, draft and failed messages.
Returns a `Promise` that resolves with array of message objects. Each message has a `tag` property by which you can check message type: 

| tag   | meaning             |
| ----- | ------------------- |
| `'0'` | Received SMS        |
| `'1'` | Unread received SMS |
| `'2'` | Sent SMS            |
| `'3'` | Failed sent SMS
| `'4'` | Draft SMS           |

Example of `message` object
```js
{
  id: '148',
  number: '+386123456789',
  content: 'Cool 😎',
  tag: '0',
  date: '25/01/24 19:56:09',
  draft_group_id: '',
  received_all_concat_sms: '1',
  concat_sms_total: '0',
  concat_sms_received: '0',
  sms_class: '4'
}
```

- #### `sendSms(number, message)`
`number [string]` - phone number of the SMS recipient
`message [string]` - SMS message

Sends the SMS to a given number.
Returns a `Promise` that resolves with sent SMS message object if SMS was sent and is rejected otherwise.

- #### `setSmsAsRead(smsIds)`
`smsIds [Array<String>]` - array of SMS IDs you want to mark as read. 

Sets the status of the received SMS with given id to read.
Have in mind that you can only mark SMS as read if it has a `tag` of `1` that then becomes `0`.
Returns a `Promise` that resolves if SMS messages were successfully marked as read.

- #### `setAllSmsAsRead()`
Sets the status of all unread SMS messages to read. (tag from `1` to `0`)
Returns a `Promise` that resolves if SMS messages were successfully marked as read.

- #### `deleteSms(smsIds)`
`smsIds [Array<String>]` - array of SMS IDs you want to delete from the modem. 

Deletes the SMS messages of given ids from zte modem.
Returns a `Promise` that resolves if SMS messages were successfully deleted.

- #### `deleteAllSms()`
Deletes ALL SMS messages from ZTE modem regardless of the tag ('received', 'sent', 'unread', 'failed', 'drafts').
Returns a `Promise` that resolves if SMS messages were successfully deleted.

- #### `getSmsCapacityInfo()`
Returns a `Promise` that resolves with a modem SMS capacity info object.

Example:
```js
{
  sms_nv_total: '100',
  sms_sim_total: '20',
  sms_nvused_total: '30',
  sms_nv_rev_total: '3',
  sms_nv_send_total: '22',
  sms_nv_draftbox_total: '5',
  sms_sim_rev_total: '0',
  sms_sim_send_total: '0',
  sms_sim_draftbox_total: '0'
}
```

## Usage
Construct new instance of the Modem with IP of the modem and modem password:

```js
const Modem = require('@zigasebenik/zte-sms');
const myModem = new Modem({ modemIP: '192.168.0.1', modemPassword: 'password'});

(async () => {
  try {
    await myModem.sendSms('000000000', 'My message');
    const allSMSMessages = await myModem.getAllSms();
    console.log(allSMSMessages);
  } catch (err) {
    console.error(err);
  }
})();
```
