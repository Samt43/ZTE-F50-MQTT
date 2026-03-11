const merge = require('lodash.merge');
const http = require('http');
const qs = require('qs');
const { hex_md5 } = require('./md5');
const crypto = require("crypto");

const {
  getCurrentTimeString,
  encodeMessage,
  decodeMessage,
  transTime,
  promiseRetry,
} = require('./utils');

class Modem {
  constructor({ modemIP = '192.168.0.1', modemPassword = ''} = {}) {
    this.modemIP = modemIP;
    this.modemPassword = modemPassword
    this.getPath = `/goform/goform_get_cmd_process`;
    this.setPath = `/goform/goform_set_cmd_process`;
    this.referer = `http://${this.modemIP}/index.html`;

    this.loginCookieValue = '';
    this.modemVersion = '';
  }

  async #request(options, data = '') {
    const headers = { Referer: this.referer };

    data = qs.stringify(data);
    options.path = this.getPath;
    if (options.method === 'POST') {
      options.path = this.setPath;
      headers['Content-Length'] = data.length;
      headers['Content-Type'] = "application/x-www-form-urlencoded";
    } else if (options.method === 'GET') {
      options.path += `?${data}`;
      data = '';
    }

    options = merge(options, {
      hostname: this.modemIP,
      insecureHTTPParser: true,
      headers,
    });

    return new Promise((resolve, reject) => {
      const request = http.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk.toString();
        });
        response.on('end', () => {
          resolve({ response, data: JSON.parse(data) });
        });
        response.on('error', (error) => {
          reject(error);
        });
      });
      request.on('error', (error) => { reject(error); });
      data && request.write(data);
	    request.end();
    });
  }

  async #login() {
    const ldResponse = await this.#request({ method: "GET" }, { cmd: "LD", isTest: false });
    if (!ldResponse.data.LD) {
      throw new Error("Failed to retrieve salt (LD) from modem.");
    }
    const ld = ldResponse.data.LD;

    const firstHash = crypto.createHash("sha256").update(this.modemPassword).digest("hex").toUpperCase();
    const finalHash = crypto
      .createHash("sha256")
      .update(firstHash + ld)
      .digest("hex")
      .toUpperCase();

    const data = {
      isTest: false,
      goformId: "LOGIN",
      password: finalHash,
    };
    const options = { method: 'POST' };
    const response = await this.#request(options, data);

    if (response.data.result != '0') {
      throw new Error("Login to modem failed.");
    }
    this.loginCookieValue = response.response.headers["set-cookie"][0].split(";")[0];
  }

  async #logout() {
    const data = {
      isTest: false,
      goformId: 'LOGOUT',
      AD: await this.#getAD(),
    };
    const options = {
      method: 'POST',
      headers: { Cookie: this.loginCookieValue },};
    await this.#request(options, data);
    this.loginCookieValue = '';
  }

  async #getModemVersion() {
    if (this.modemVersion) {
      return this.modemVersion;
    }
    const data = {
      isTest: false,
      cmd: 'cr_version,wa_inner_version',
      multi_data: 1,
    }
    const options = { method: 'GET' };
    const response = await this.#request(options, data);
    if (response.data.wa_inner_version || response.data.cr_version) {
      this.modemVersion = `${response.data?.wa_inner_version}${response.data?.cr_version}`;
      return this.modemVersion;
    } else {
      throw new Error('Getting modem version failed.');
    }
  }

  async #getAD() {
    const modemVersion = await this.#getModemVersion();
    const RD = await this.#getRD();

    const sessionID = this.loginCookieValue.replace("JSESSIONID=", "");
    const firstHash = crypto.createHash("sha256").update(modemVersion).digest("hex").toUpperCase();
    const finalHash = crypto
      .createHash("sha256")
      .update(firstHash + sessionID)
      .digest("hex")
      .toUpperCase();

    return finalHash;
  }

  async #getRD() {
    const data = {
      isTest: false,
      cmd: 'RD',
    }
    const options = { method: 'GET', headers: { Cookie: this.loginCookieValue }};
    const response = await this.#request(options, data);

    if (!response.data.RD) {
      throw new Error('Getting RD failed.');
    }
    return response.data.RD;
  }

  async #getCmdStatusInfo(sms_cmd) {
    const data = {
      isTest: false,
      cmd: 'sms_cmd_status_info',
      sms_cmd,
    };
    const options = {
      method: 'GET',
      headers: { Cookie: this.loginCookieValue },
    };
    const response = await this.#request(options, data);
    return response.data;
  }

  async #awaitConfirmation(sms_cmd) {
    await promiseRetry(async () => {
      const info = await this.#getCmdStatusInfo(sms_cmd);
      return (!info?.sms_cmd_status_result || info.sms_cmd_status_result === '1')
        ? Promise.reject()
        : Promise.resolve();
    });
  }

  async getSmsCapacityInfo() {
    await this.#login();
    const data = {
      isTest: false,
      cmd: 'sms_capacity_info',
    };
    const options = {
      method: 'GET',
      headers: { Cookie: this.loginCookieValue },
    };
    const response = await this.#request(options, data);
    await this.#logout();
    return response.data;
  }

  async getAllSms() {
    await this.#login();
    const data = {
      isTest: false,
      cmd: 'sms_data_total',
      page: 0,
      data_per_page: 5000,
      mem_store: 1,
      tags: 10,
      order_by: 'order by id desc',
    };
    const options = {
      method: 'GET',
      headers: { Cookie: this.loginCookieValue },
    };
    const response = await this.#request(options, data);
    await this.#logout();
    response.data.messages.forEach((m) => {
      m.date = transTime(m.date, '3', '24');
      m.content = decodeMessage(m.content);
    });
    return response.data.messages;
  }

  async deleteSms(ids) {
    ids = Array.isArray(ids) ? ids : Array(ids);
    await this.#login();
    const data = {
      isTest: false,
      goformId: 'DELETE_SMS',
      msg_id: `${ids.join(';')};`,
      notCallback: true,
      AD: await this.#getAD(),
    };
    const options = {
      method: 'POST',
      headers: { Cookie: this.loginCookieValue },
    };
    const response = await this.#request(options, data);
    await this.#awaitConfirmation(6);
    await this.#logout();
    if (response.data.result !== 'success') {
      throw new Error('Error deleting SMS.');
    }
  }

  // sms tags
  // 1	Unread received message.
  // 0	Received message.
  // 2	Message sent.
  // 3	Message failed to be sent.
  // 4	Draft.
  async deleteAllSms(tag = '') {
    tag = tag.toString();
    let messages = await this.getAllSms();
    messages = messages.filter((m) => !tag || m.tag === tag);
    const messageIds = messages.map((m) => m.id);
    return await this.deleteSms(messageIds);
  }

  async setSmsAsRead(ids) {
    ids = Array.isArray(ids) ? ids : Array(ids);
    await this.#login();
    const data = {
      isTest: false,
      goformId: 'SET_MSG_READ',
      msg_id: `${ids.join(';')};`,
      tag: '0',
      AD: await this.#getAD(),
    };
    const options = {
      method: 'POST',
      headers: { Cookie: this.loginCookieValue },
    };
    const response = await this.#request(options, data);
    if (response.data.result !== 'success') {
      throw new Error('Error marking SMS as read.');
    }
    await this.#awaitConfirmation(5);
    await this.#logout();
  }

  async setAllSmsAsRead() {
    let messages = await this.getAllSms();
    messages = messages.filter((m) => m.tag === '1');
    const messageIds = messages.map((m) => m.id);
    return await this.setSmsAsRead(messageIds);
  }

  async sendSms(number, message) {
    await this.#login();
    const sms_time = getCurrentTimeString();
    const sms_time_compare = transTime(sms_time.replaceAll(';', ','), '3', '24');
    const data = {
      isTest: false,
      goformId: 'SEND_SMS',
      notCallback: true,
      Number: number.toString(),
      sms_time,
      MessageBody: encodeMessage(message),
      ID: -1,
      encode_type: 'UNICODE',
      AD: await this.#getAD(),
    };
    const options = {
      method: 'POST',
      headers: { Cookie: this.loginCookieValue },
    };
    const response = await this.#request(options, data);
    if (response.data.result !== 'success') {
      throw new Error('Error sending SMS.');
    }
    await this.#awaitConfirmation(4);
    let messages = await this.getAllSms();
    message = messages.filter((m) => 
      m.tag === '2' &&
      m.number === number &&
      m.content === message &&
      sms_time_compare === m.date
    );
    await this.#logout();
    return message;
  }
}

module.exports = Modem;
