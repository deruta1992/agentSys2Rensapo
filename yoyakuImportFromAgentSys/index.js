console.log('Loading function');
const axios = require('axios');
const AWS = require('aws-sdk');
const fs = require('fs');

const baseScopeUrl = "https://oceantravel.scopeapps.net/"
const contractid = 2;

exports.handler = async (event, context) => {
    for (const record of event.Records) {
      try{
        console.log(record.eventID);
        console.log(record.eventName);
        switch(record.eventName){
        case "INSERT":
          let data = record.dynamodb.NewImage;
          let email = null;
          if(data["reservedBy"]){
            email = data["reservedBy"]["S"]
          }
          if(data["carinfo"]){
            let carInfo = data["carinfo"];
            console.log(carInfo["L"])
            for(let i = 0; i < carInfo["L"].length; i++){
              data = record.dynamodb.NewImage
              let dataPre = carInfo["L"][i]["M"]
              console.log(dataPre)
              if(parseInt(dataPre["car_numbers"]["N"]) > 0){
                console.log(dataPre)
                let subtotal = 0
                let optionTxt = "";
                if(dataPre["sub_total"]){ subtotal = parseInt(dataPre["sub_total"]["N"]); }
                if(dataPre["subtotal"]){ subtotal = parseInt(dataPre["subtotal"]["N"]); }
                if(dataPre["option_txt"]){ optionTxt = dataPre["option_txt"]["S"]; }
                data["car_class"] = {"S": dataPre["car_class"]["S"]};
                data["car_plan_name"] = {"S": dataPre["car_plan_name"]["S"]};
                data["option_charge"] = {"S": dataPre["option_charge"]["N"]};
                if(dataPre["noc_charge"]){
                  data["noc_charge"] = {"S": dataPre["noc_charge"]["N"]};
                } else {
                  data["noc_charge"] = 0;
                }
                //
                data["number_of_people"] = {"S": data["people_num"]["N"]};
                data["reserve_st_place"] = {"S": data["reserve_st_place"]["S"]};
                data["reserve_ed_place"] = {"S": data["reserve_ed_place"]["S"]}
                data["departure"] = {"S": data["departure"]["S"]};
                data["arrival"] = {"S": data["arrival"]["S"]};
                //
                data["option_txt"] = {"S": optionTxt};
                data["carnum"] = {"N": dataPre["car_numbers"]["N"]};
                data["totalPrice"] ={"N":subtotal};
                data["reservation_no"] = {"S": data["reserveno"]["S"]}
                const dataProcess = await convertAndImportRecord(data);
                const sendReserveMails = await sendReserveMail(dataProcess["data"],email);
                const agsysRelate = await recordAlotUsage(dataProcess["data"])
              } else {
                console.log("no content")
              }
            }
          } else {
            const dataProcess = await convertAndImportRecord(data)
            const sendReserveMails = await sendReserveMail(dataProcess["data"],email)
            const agsysRelate = await recordAlotUsage(data,"reserve")
          }
        break;
        case "MODIFY":
          let dataCl = record.dynamodb.NewImage;
          let emailCl = null;
          if(dataCl["reservedBy"]){
            emailCl = dataCl["reservedBy"]["S"]
          }
          if(dataCl["deleteFlug"]){
            if(dataCl["carinfo"]){
              let carInfo = dataCl["carinfo"];
              console.log(carInfo["L"])
              for(let i = 0; i < carInfo["L"].length; i++){
                let data = record.dynamodb.NewImage
                let dataPre = carInfo["L"][i]["M"]
                console.log(dataPre)
                if(parseInt(dataPre["car_numbers"]["N"]) > 0){
                  console.log(dataPre)
                  let subtotal = 0
                  let optionTxt = "";
                  data["carnum"] = {"N": dataPre["car_numbers"]["N"]};
                  data["car_class"] = {"S": dataPre["car_class"]["S"]};
                  data["car_class"] = dataPre["car_class"]["S"];
                  if(!dataPre["noc_charge"]){
                    data["noc_charge"] = 0;
                  }
                  await recordAlotUsage(dataCl,"cancel")
                  await sendCancelMail(dataCl, emailCl)
                } else {
                  console.log("no content")
                }
              }
            } else {
              await recordAlotUsage(dataCl,"cancel")
              await sendCancelMail(dataCl, emailCl)
            }
          }// something
          break;
        default:
          console.log("no matched EVENT.");
          break;
      } // end switch
    } catch(e){
      console.log({
        "error": e
      })
    }
  } // end for
  return `Successfully processed ${event.Records.length} records.`;
};

async function flattenJson(data){
  let jsonPre = new Array();
  let start_office = 0;
  let end_office = 0;
  let paramsA = JSON.parse(JSON.stringify((data)))
  console.log(paramsA)
  let count = Object.keys(paramsA);
  for(let i = 0; i < count.length; i++){
    let header = Object.keys(paramsA)[i];
    //console.log(header)
    switch(header){
      case "departure": // "start_office":
        start_office = await convertOffice(paramsA[header][0]);
        break;
      case "arrive": // "return_orrice":
        end_office = await convertOffice(paramsA[header][0]);
        break;
      default: break;
    }
    jsonPre[header] = paramsA[header][Object.keys(paramsA[header])[0]];
  }
  //
  jsonPre["start_office_id"] = start_office;
  jsonPre["return_orrice_id"] = end_office;
  console.log(jsonPre)
  if(!end_office){
    jsonPre["return_orrice_id"] = start_office;
  }
  //
  return jsonPre;
}

async function recordAlotUsage(data, opeType){
  // from, to, car_class, car_num, dept
  console.log(data)
  let car_num = data["carnum"]["N"]
  let deptdate;
  let arricedate;
  switch(opeType){
    case "reserve":
      deptdate = data["dept_datetime"];
      arrivedate = data["arrive_datetime"];
      break;
    case "cancel":
      car_num = car_num * -1
      deptdate = data["dept_datetime"]["S"];
      arrivedate = data["arrive_datetime"]["S"];
      break;
    default:
      car_num = data["carnum"]
      deptdate = data["dept_datetime"];
      arrivedate = data["arrive_datetime"];
      break;
  }
  //
  console.log(deptdate, arrivedate)
  let deptArr = deptdate.split(" ");
  let arriveArr = arrivedate.split(" ");
  //
  let dept = {
      date: deptArr[0],
      time: deptArr[1]
  }
  let arrive = {
      date: arriveArr[0],
      time: arriveArr[1]
  }
  //
  let from = dept.date; from = await convertToDate8Str(from)
  let to = arrive.date; to = await convertToDate8Str(to)
  //
  let car_class = data["car_class"]
  if(car_class["S"]){
    car_class = car_class["S"]
  }
  //
  let agent = data["company"]
  if(agent["S"]){
    agent = agent["S"]
  }
  //
  let dept_sales = data["dept_sales"]
  if(dept_sales["N"]){dept_sales = dept_sales["N"];}
  if(dept_sales["S"]){dept_sales = dept_sales["S"];}
  //
  try{
    const token = await getAuthToken()
    let url = baseScopeUrl + "api/rentacar/agent/zaiko/update"
    let params = {
      headers: {
        ContentType: "application/json",
        Authorization: "Bearer " + token
      },
      json: {
        from_date: from,
        to_date: to,
        agent: agent,
        car_class: car_class,
        car_num: car_num,
        dept_sales: dept_sales
      }
    }
    console.log(params)
    const execUpdate = await axios.post(url, params["json"], params)
    console.log(execUpdate.data)
    if(execUpdate.status == 200){
      return "ok";
    } else {
      return "ng"
    }
  } catch(e){
    console.log(e.response)
    return "ng"
  }
}

async function convertToDate8Str(dateStr){
  let dateArr = dateStr.split('/');
  let yearval = dateArr[0]; let monthval = dateArr[1]; let dateval = dateArr[2];
  if(monthval.length == 1){ monthval = "0"+monthval; }
  if(dateval.length == 1){ dateval = "0"+dateval; }
  return yearval+monthval+dateval;
}

async function getAuthToken(){
    let authUrl = baseScopeUrl + "api/authenticate";
    let params = {
        email: "system@ocean-travel.jp",
        password: "Ocean-385"
    }
    try{
        const data = await axios.post(authUrl, params)
        return data.data.token;
    } catch(e){
        console.log(e)
        throw(e)
    }
}

async function convertAndImportRecord(params){
    const dataGen = await flattenJson(params)
    const reqDatagen = await generateReqJson(dataGen);
    console.log(reqDatagen);
    if(reqDatagen.result == "success" && dataGen["ota_id"] != 2){
      const reserve = await importReserves(reqDatagen.data,dataGen);
      console.log(reserve)
      if(!reserve.body.result){
        console.log("API Request Failed");
        await sendErrToShops(reqDatagen.data,dataGen)
      }
    }
    return {
      data: dataGen
    }
    //callback();
};

async function generateReqJson(data){
    try{
      console.log(data);
        let email = "example@example.com";
          if(data["reserve_email"]){
              email = data["reserve_email"];
          }
          //日付部分の定義
          let deptdate = data["dept_datetime"];
          let arrivedate = data["arrive_datetime"];
          //console.log(deptdate, arrivedate)
          let deptArr = deptdate.split(" ");
          let arriveArr = arrivedate.split(" ");
          let dept = {
              date: deptArr[0],
              time: deptArr[1]
          }
          let arrive = {
              date: arriveArr[0],
              time: arriveArr[1]
          }
          //
          let optionTotal = 0;
          if(data["option_charge"]){
            optionTotal = data["option_charge"];
          }
          if(data["noc_charge"]){
            optionTotal = optionTotal + data["noc_charge"]
          }
          let phone = "";
          if(data["reserve_phone"]){
            phone = data["reserve_phone"];
          }
          let otaid = 0;
          let agentname = "";
          if(data["company"]){
              const otaInfo = await fetchOtaInfo(parseInt(data["agent"]))
              otaid = otaInfo.agentid;
              agentname = otaInfo.agentname;
          }
          const class_id = await convertCarClassId(data["car_class"]);
          let routecate = 6;
          if(data["agent"]){
              routecate = 11;
          }
          let note = "";
          if(data["note"]){
            note = data["note"];
          }
          let startid = data["dept_sales"];
          if(!startid){ startid = 0; }
          let endid = data["arr_sales"];
          if(!endid){ endid = 0; }
          //レスポンスする値
          let reqData = {
              Kana1: data["reserve_name"],
              Kana2: " ",
              email: email,
              work_memo_yoyaku: "(APIにて登録 from "+agentname+")" + note,
              people: (data["number_of_people"] || 1),
              phone1: phone,
              category1: routecate,
              category2: otaid,
              //
              arrival_info: data["arrival"],
              car_class_id: class_id,
              car_office_start_id: startid,
              car_office_end_id: endid,
              date: dept.date,
              time: dept.time,
              dateE: arrive.date,
              timeE: arrive.time,
              carnum: 1,
              basic_price: (parseInt(data["basic_charge"]) || 0),
              location_price: 0,//乗り捨て料金
              opt_total_price: optionTotal,
              //オプション
              car_reservation_no: data["reservation_no"],
              car_plan_id: (data["car_plan_id"] || 0).toString(),
              car_plan_name: (data["car_plan_name"] || "").toString(),
              car_class: data["car_class"],
          }
          for(let j = 0; j < reqData.length; j++){
            if(!reqData[j]){
              reqData[j] = "";
            }
          }
          return {
            result: "success", data: reqData
        }
    } catch(e){
        console.log(e);
        return {
            result: "err", data: e
        }
    }
}

async function fetchOtaInfo(agentid){
  try{
    const token = await getAuthToken()
    let url = baseScopeUrl + "api/rentacar/agent/convert/agentid?agentid="+agentid
    let params = {
      headers: {
        ContentType: "application/json",
        Authorization: "Bearer " + token
      }
    }
    console.log(params)
    const execUpdate = await axios.get(url, params)
    console.log(execUpdate.data)
    if(execUpdate.status == 200){
      return execUpdate.data;
    } else {
      return "ng" 
    }
  } catch(e){
    console.log(e.response)
    return "ng"
  }
}

async function convertCarClassId(carClassStr){
  try{
    const token = await getAuthToken()
    let url = baseScopeUrl + "api/rentacar/agent/convert/car?classname="+carClassStr
    let params = {
      headers: {
        ContentType: "application/json",
        Authorization: "Bearer " + token
      }
    }
    console.log(params)
    const execUpdate = await axios.get(url, params)
    console.log(execUpdate.data)
    if(execUpdate.status == 200){
      return execUpdate.data;
    } else {
      return "ng" 
    }
  } catch(e){
    console.log(e.response)
    return "ng"
  }
}

async function convertOffice(office){
  try{
    const token = await getAuthToken()
    let url = baseScopeUrl + "api/rentacar/agent/convert/shop?shopname="+office
    let params = {
      headers: {
        ContentType: "application/json",
        Authorization: "Bearer " + token
      }
    }
    console.log(params)
    const execUpdate = await axios.get(url, params)
    console.log(execUpdate.data)
    if(execUpdate.status == 200){
      return execUpdate.data;
    } else {
      return "ng" 
    }
  } catch(e){
    console.log(e.response)
    return "ng"
  }
}

async function importReserves(reqData,rawJson){
    let url = "https://www.pine-sys.com/admin/apisites/save_data/booking_new/";
    let bodyJson = {
    Login: {
      token: "xAxF3r7ASVtEFFPiXFLY"
    },
    //Data: {
      Member: {
          //必須
        kana1: reqData.Kana1,
        kana2: reqData.Kana2,
        email: reqData.email,
        //オプション
        //cmn_pref_id: cmn_pref_id,
        phone1: reqData.phone1,
        //reserveMemo: reserveMemo,
        people: parseInt(reqData.people),
      },
      Reserve: {
          //必須
        car_class_id: reqData.car_class_id,
        car_office_start_id: reqData.car_office_start_id,
        car_office_end_id: reqData.car_office_end_id,
        category1: reqData.category1,
        category2: parseInt(reqData.category2),
        date: reqData.date,
        time: reqData.time,
        dateE: reqData.dateE,
        timeE: reqData.timeE,
        carnum: reqData.carnum,
        basic_price: parseInt(reqData.basic_price),
        location_price: 0,//乗り捨て料金
        opt_total_price: reqData.opt_total_price,
        work_memo: "APIにて登録(via "+reqData.ota_name + ","+reqData.car_class+")\n"+reqData.work_memo_yoyaku+"\n" + reqData.arrival_info,
        //オプション
        car_reservation_no: reqData.car_reservation_no
      }
    //}
  }
  let options = {
      headers: {}
  }
  console.log(bodyJson)
  const req_rensapo = await axios.post(url, bodyJson, options);
  if(req_rensapo.status == 200){
    return {success: 'get call succeed!', status: req_rensapo.status, body: req_rensapo.data};
  } else {
    return {failed: 'get call failed!', status: req_rensapo.status, body: req_rensapo.body};  
  }
}

async function sendErrToShops(reqData, rawJson){
  let params = {
    'agentname': rawJson.ota_name,
    'reserveno': reqData.car_reservation_no,
    'csname': reqData.Kana1,
    'dept_datetime': reqData.date,
    'arr_datetime': reqData.dateE,
    'dept_shopname': rawJson.start_office,
    'car_class': reqData.carClass,
    'reserved_datetime': reqData,reserved_datetime,
    'cid': contract_id
  }
  let url = "https://admincontrol.carcontroller.net/api/v1/notify";
  let options = {
      headers: {}
  }
  const req_convert = await axios.post(url, params, options);
  console.log("Err msg send status:"+req_convert.status);
  return req_convert.status;
}

async function sendReserveMail(data, email){
  var honbun_read = await getHonbun(1, data.company);
  let honbun = honbun_read.toString();
  const dataGen = data;
  
  let keys = Object.keys(data)
  console.log("keys")
  console.log(keys)
  const subHonbun = await genMailHonbun(data,dataGen,keys,honbun)
  honbun = subHonbun
  console.log(honbun)
  let sendTo = dataGen["reserve_email"]
  if(sendTo == "example@example.com"){
    sendTo = "info@pine-rentacar.jp"
  }
  let reserveNo = dataGen["reserveKey"]
  //メール送信
  let bcc_address = [
    'k.kawashima@ocean-travel.jp',
    'info@pine-rentacar.jp'
  ]
  if(email){ bcc_address.push(email) }
  let mailParam = {
  Destination: { 
    BccAddresses: bcc_address,
    ToAddresses: [
      sendTo
    ]
  },
  Message: {
    Body: {
      Text: {
       Charset: "UTF-8",
       Data: honbun
      }
     },
     Subject: {
      Charset: 'UTF-8',
      Data: '予約完了メール(パインレンタカー, 予約番号:'+reserveNo+", "+dataGen["reserve_name"] +"様 )"
     }
    },
  Source: 'info@pine-rentacar.jp', /* required */
  ReplyToAddresses: [
     'info@pine-rentacar.jp'
  ],
};
  console.log(mailParam);
  const sendMail = new AWS.SES({apiVersion: '2010-12-01',region: 'ap-northeast-1'}).sendEmail(mailParam).promise();
  return new Promise(function(resolve, reject){
    sendMail.then(function(data) {
      console.log(data.MessageId);
      resolve(data.MessageId)
    }).catch(function(err) {
        console.log(err, err.stack);
        reject(err)
    });
  })
}

async function getHonbun(agent, type){
  try{
    const token = await getAuthToken()
    let url = baseScopeUrl + "api/rentacar/agent/settings/mail?agentid="+agent+"&mailtype="+type
    let params = {
      headers: {
        ContentType: "application/json",
        Authorization: "Bearer " + token
      }
    }
    console.log(params)
    const execUpdate = await axios.get(url, params)
    console.log(execUpdate.data)
    if(execUpdate.status == 200){
      return execUpdate.data["data"];
    } else {
      return "ng" 
    }
  } catch(e){
    console.log(e.response)
    return "ng"
  }
}

async function genMailHonbun(data,dataGen,keys,honbun){
  return new Promise(function(resolve, reject){
    console.log(keys.length)
    try{
      //for(let g = 0; g < keys.length; g++){
      let g = 0;
      keys.forEach(function(replaceKey){
        let taisyo = "[["+replaceKey+"]]"
        let after = dataGen[replaceKey]
        honbun = honbun.replace(new RegExp(taisyo, 'g'), after)
        //console.log(g+1,keys.length)
        if(g + 1 == keys.length){
          resolve(honbun)
        }
        g++;
      })
      //}
    } catch(e){
      console.log(e)
      reject(e)
    }
  })
}

async function sendCancelMail(data, email){
  var honbun_read = await getHonbun(2);
  let honbun = honbun_read.toString();
  const dataGen = await flattenJson(data)
  let keys = Object.keys(data)
  const subHonbun = await genMailHonbun(data,dataGen,keys,honbun)
  honbun = subHonbun
  let sendTo = dataGen["reserve_email"]
  if(sendTo == "example@example.com"){
    sendTo = "info@pine-rentacar.jp"
  }
  let reserveNo = dataGen["reserveKey"]
  //メール送信
  let bcc_address = [
    'info@pine-rentacar.jp',
    'k.kawashima@ocean-travel.jp'
  ]
  if(email){ bcc_address.push(email) }
  let mailParam = {
  Destination: { 
    BccAddresses: bcc_address,
    ToAddresses: [
      sendTo
    ]
  },
  Message: {
    Body: {
      Text: {
       Charset: "UTF-8",
       Data: honbun
      }
     },
     Subject: {
      Charset: 'UTF-8',
      Data: '予約キャンセルメール(パインレンタカー, 予約番号:'+reserveNo+", "+dataGen["reserve_name"] +"様 )"
     }
    },
  Source: 'info@pine-rentacar.jp', /* required */
  ReplyToAddresses: [
     'info@pine-rentacar.jp'
  ],
};
  console.log(mailParam);
  const sendMail = new AWS.SES({apiVersion: '2010-12-01',region: 'us-east-1'}).sendEmail(mailParam).promise();
  return new Promise(function(resolve, reject){
    sendMail.then(function(data) {
      console.log(data.MessageId);
      resolve(data.MessageId)
    }).catch(function(err) {
        console.log(err, err.stack);
        reject(err)
    });
  })
}