function getCurrentTimeString(e) {
  let t = '';
  let n = e || new Date;
  return t += (n.getFullYear() + "").substring(2) + ";",
    t += getTwoDigit(n.getMonth() + 1) + ";" + getTwoDigit(n.getDate()) + ";" + getTwoDigit(n.getHours()) + ";" + getTwoDigit(n.getMinutes()) + ";" + getTwoDigit(n.getSeconds()) + ";",
    n.getTimezoneOffset() < 0 ? t += "+" + (0 - n.getTimezoneOffset() / 60) : t += 0 - n.getTimezoneOffset() / 60,
    t;
}

function getTwoDigit(e) {
  for (e += ""; e.length < 2;) {
    e = "0" + e;
  }
  return e
}

function dec2hex(e) {
  return (e + 0).toString(16).toUpperCase()
}

function hex2char(e) {
  let t = '';
  let n = parseInt(e, 16);
  return n <= 65535 ? t += String.fromCharCode(n) : n <= 1114111 && (n -= 65536,
    t += String.fromCharCode(55296 | n >> 10) + String.fromCharCode(56320 | 1023 & n)),
    t
}

function leftInsert(e, t, n) {
  for (var o = e.toString().length; o < t; o++)
    e = n + e;
  return e
}

function transTime(e, t, n) {
  var o = e.split(",");
  if (0 == o.length || -1 != ("," + e + ",").indexOf(",,"))
    return "";
  var r;
  r = "1" == t ? o[2] + "/" + o[1] + "/" + o[0] + " " : "2" == t ? o[1] + "/" + o[2] + "/" + o[0] + " " : o[0] + "/" + o[1] + "/" + o[2] + " ";
  var i;
  if ("12" == n) {
    var a = trans12hourTime(leftInsert(o[3], 2, "0"));
    i = a[0] + ":" + leftInsert(o[4], 2, "0") + ":" + leftInsert(o[5], 2, "0") + " " + a[1]
  } else
    i = leftInsert(o[3], 2, "0") + ":" + leftInsert(o[4], 2, "0") + ":" + leftInsert(o[5], 2, "0");
  return r + i
}
function trans12hourTime(e) {
  var t, n;
  return e = parseInt(e),
    e > 12 ? (t = "PM",
      n = e - 12) : 12 == e ? (t = "PM",
        n = 12) : 0 == e ? (t = "AM",
          n = 12) : (t = "AM",
            n = e),
    [n, t]
}

function encodeMessage(e) {
  let t = 0
    , n = "";
  if (!e)
    return n;
  e = e.toString();
  for (let o = 0; o < e.length; o++) {
    let r = e.charCodeAt(o);
    if (0 != t) {
      if (56320 <= r && r <= 57343) {
        n += dec2hex(65536 + (t - 55296 << 10) + (r - 56320)),
          t = 0;
        continue
      }
      t = 0
    }
    if (55296 <= r && r <= 56319)
      t = r;
    else {
      for (cp = dec2hex(r); cp.length < 4;)
        cp = "0" + cp;
      n += cp
    }
  }
  return n
}

function decodeMessage(e, t) {
  if (!e) { return ''; }
  const specialCharsIgnoreWrap = ["0009", "0000"];
  return e.replace(/([A-Fa-f0-9]{1,4})/g, function (e, t) {
    return -1 === specialCharsIgnoreWrap.indexOf(t) ? hex2char(t) : "";
  })
}

function promiseRetry(fn, { retries = 20, interval = 200 } = {}) {
  return new Promise((resolve, reject) =>
    fn()
      .then(resolve)
      .catch((error) => {
        if (retries === 0) {
          return reject(error);
        }
        setTimeout(() => {
          promiseRetry(fn, { retries: retries - 1, interval })
            .then(resolve, reject);
        }, interval);
      }),
  );
}

module.exports = {
  getCurrentTimeString,
  encodeMessage,
  decodeMessage,
  transTime,
  promiseRetry,
}
