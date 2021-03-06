
(function(ext) {

	var SCBD_CHOCOPI = 0x10,
		SCBD_CHOCOPI_USB = 0xE0,	//Chocopie USB 연결에 대한 값 디테일(상위값 14, 포트0) 을 지정
		SCBD_CHOCOPI_USB_PING = 0xE4,
		SCBD_CHOCOPI_BLE = 0xF0,	//Chocopie BLE 연결에 대한 값 디테일(상위값 15, 포트0) 를 지정	
		SCBD_CHOCOPI_BLE_PING = 0xF4,
		SCBD_SENSOR = 8,
		SCBD_TOUCH = 9,
		SCBD_SWITCH = 10,
		SCBD_MOTION = 11,
		SCBD_LED = 12,
		SCBD_STEPPER = 13, 
		SCBD_DC_MOTOR = 14,		
		SCBD_SERVO = 15;			
		//SCBD_ULTRASONIC = 0x10,		
		//SCBD_PIR = 0x11;
	/*Chocopie const definition
	 * SCBD_ULTRASONIC 와 SCBD_PIR 은 아직 존재하지않는 확장영역으로써 설계되어져있음
	*/

	var CPC_VERSION = 0x08,		//REPORT_VERSION = 0xF9 -> CPC_VERSION 으로 PATCH -- Changed By Remoted 2016.04.14
		CPC_START = 0x09,
		CPC_STOP = 0x0A,
		CPC_SET_NAME = 0x0B,
		CPC_GET_NAME = 0x0C,
		CPC_GET_BLOCK = 0x0D,
		CPC_ALL_SAY = 0x0E;
	//Chocopie command definition
	
  var START_SYSEX = 0x7E,			//메세지의 시작패킷을 알리는 헤더		이스케이핑 필수
	  END_SYSEX = 0x7E;			//메세지의 꼬리패킷을 알리는 테일러		이스케이핑 필수

  var SAMPLING_RATE = 1;

  var LOW = 0x00FF,
    HIGH = 0xFF00;
	//LOW, HIGH 를 연산하기 위해서 패치함 -- 2016.04.20 
  
  var majorVersion = 0,
      minorVersion = 0;

  var connected = false;
  var notifyConnection = false;
  var device = null;
  var inputData = null;

  // TEMPORARY WORKAROUND
  // Since _deviceRemoved is not used with Serial devices
  // ping device regularly to check connection
  var pinging = false;
  var pingCount = 0;
  var pinger = null;
    function prepareDataToSend(bytearray){
	  var data = [];
	  //var data = new Array();
	  var checksum=0xFF;
	  data.push(START_SYSEX);
	  for(var i= 0;i< bytearray.length;i++){
		  if((bytearray[i]==0x7E ) || (bytearray[i]==0x7D ) ){
			 data.push(0x7D);
			 data.push(bytearray[i]^0x20);
			 checksum^= 0x7D;
			 checksum^= bytearray[i]^0x20;
		  }else{
			 data.push(bytearray[i]);
			 checksum^= bytearray[i];
		  }		  		 
	  }
	  data.push(checksum);
	  data.push(START_SYSEX);
	  var u8a= new Uint8Array(data.length);
	  var logstring="send:";
	  for(var i=0;i<data.length;i++){
		u8a[i]=data[i];
		logstring+= data[i].toString(16)+", ";
	  } 
	  console.log(logstring);
	  return u8a;
	
  }
  
 function send2byteCommand(c1, c2){
	  var data = new Uint8Array(2);	  
	  data[0]=c1;data[1]=c2;
	  device.send(prepareDataToSend(data).buffer);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
  }
  
  function send_array(data){
	  device.send(prepareDataToSend(data).buffer);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
  }
  



  function checkSum(detailnport, data){
		var sum = 0xFF ^ detailnport;		//2016.04.28 패치요청 들어옴.. -> 보드도착시 변경
		sum ^= data;		
		return sum;
	}
  function init() {
	
    // TEMPORARY WORKAROUND
    // Since _deviceRemoved is not used with Serial devices
    // ping device regularly to check connection
	// setInterval 함수로 10초 단위로 6번을 핑을보내어 신호체크
    pinger = setInterval(function() {		
      if (pinging) {
        if (++pingCount > 6) {
          clearInterval(pinger);
          pinger = null;
          connected = false;
          if (device) device.close();
          device = null;
		  console.log('ping count ' + pingCount );
		  console.log('device ping over');
          return;
        }
      } else {
        if (!device) {
          clearInterval(pinger);
          pinger = null;
          return;
        }
        chocopi_ping();				//패치가 완료되면 이 부분을 주석해제, queryFirmware(); 를 제거시킴 -- 2016.04.25
        pinging = true;
      }
    }, 10000);
  }

  function chocopi_ping(){
	var usb_output = new Uint8Array([ SCBD_CHOCOPI_USB_PING]);	
	send_array(usb_output);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
  }

  function queryFirmware() {
	//해당 함수에서는 QUERY FIRMWARE 를 확인하는 메세지를 전송만 하고, 받아서 처리하는 것은 processInput 에서 처리
	//processInput 에서 query FIRMWARE 를 확인하는 메세지를 잡아서 처리해야함
	send2byteCommand(SCBD_CHOCOPI_USB, CPC_VERSION);	
	console.log("queryFirmware sended");
  }
  //Changed BY Remoted 2016.04.11
  //Patched BY Remoted 2016.04.15


	function setVersion(major, minor) {
		majorVersion = major;
		minorVersion = minor;
	}

	function escape_control(source){
		if(source == 0x7E){
			var msg = new Uint8Array([0x7D, 0x7E ^ 0x20]);
			return msg;
		}else if (source == 0x7D){
			var msg = new Uint8Array([0x7D, 0x7D ^ 0x20]);
			return msg;
		}else{
			return source;
		}
	}

//---------------------------------------------------------------------------------------------------------------
	var s = {action:null, packet_index: 0, packet_buffer: null, block_port_usb : {}, block_port_ble : {}, port : 0, detail : 0, blockList : null,
		SENSOR_TEMP_VALUE : 0x40, SENSOR_HUMD_VALUE : 0x50, SENSOR_LIGHT_VALUE : 0x60, SENSOR_AN1_VALUE : 0x00, SENSOR_AN2_VALUE : 0x10, SENSOR_AN3_VALUE : 0x20, SENSOR_AN4_VALUE : 0x30,
		MOTION_IR_VALUE : 0x10, MOTION_ACCEL_VALUE : 0x20, MOTION_PACCEL_VALUE : 0x30, MOTION_PHOTO1_ON : 0x80, MOTION_PHOTO1_OFF : 0x90,
		MOTION_PHOTO2_ON : 0xA0, MOTION_PHOTO2_OFF : 0xB0, MOTION_ALLPHOTO_STATUS : 0xC0, TOUCH_BUTTON_OFF : 0x00, TOUCH_BUTTON_ON : 0x10, TOUCH_ALLBUTTON_STATUS : 0x20,
		SWITCH_BUTTON_ON : 0x10, SWITCH_BUTTON_OFF : 0x00, SWITCH_POTENCY_VALUE : 0x30, SWITCH_JOYX_VALUE : 0x40, SWITCH_JOYY_VALUE : 0x50, SWITCH_ALLBUTTON_STATUS : 0x60};

	function servo_block(){
		this.name = "servo";
		this.port= -1;
	}	
	
	function dc_motor_block(){
		this.name = "dc_motor";
		this.port= -1;
	}
	
	function stepper_block(){
		this.name = "stepper";
		this.port= -1;
	}
	
	function led_block(){
		this.name = "led";
		this.port= -1;
	}
	
	function sensor_block() {
		this.port= -1;
		this.analog_sensor1 = 0;
		this.analog_sensor2 = 0;
		this.analog_sensor3 = 0;
		this.analog_sensor4 = 0;
		this.temperature = 0;
		this.humidity = 0;
		this.light = 0;
		this.name = "sensor";
		
		var parent = this;
		this.parser = function(rb) {
		s.packet_buffer[s.packet_index++] = rb;		
		  if (s.packet_index < 2) return;
		  if (s.detail === s.SENSOR_TEMP_VALUE){
			 parent.temperature = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SENSOR_HUMD_VALUE){
			 parent.humidity = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SENSOR_LIGHT_VALUE){
			 parent.light = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SENSOR_AN1_VALUE){
			 parent.humidity = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SENSOR_AN2_VALUE){
			 parent.analog_sensor1 = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SENSOR_AN3_VALUE){
			 parent.analog_sensor2 = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SENSOR_AN4_VALUE){
			 parent.analog_sensor3 = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }
		  s.action = actionBranch;
		};		
	 }
	function switch_block(){
		this.port= -1;
		this.switchon_btn = new Array(6);
		this.switchoff_btn = new Array(6);
		this.potencyometer = 0;
		this.joyX = 0;
		this.joyY = 0;
		this.switchStatus = new Array(16);
		
		for(var i=0; i < 16; i++){
			this.switchStatus[i] = 0;
		}
		
		var parent = this;
		this.parser = function(rb) {
		s.packet_buffer[s.packet_index++] = rb;
		
		  if (s.detail === s.SWITCH_BUTTON_ON){
			 if (s.packet_index < 1) return;
			 parent.switchon_btn[s.packet_buffer[0]]=true ;			 
		  }else if (s.detail === s.SWITCH_BUTTON_OFF){
			 if (s.packet_index < 1) return;
			 parent.switchoff_btn[s.packet_buffer[0]]=true ;
		  }else if (s.detail === s.SWITCH_POTENCY_VALUE){
			 if (s.packet_index < 2) return;
			 parent.potencyometer = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SWITCH_JOYX_VALUE){
			 if (s.packet_index < 2) return; 
			 parent.joyX = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SWITCH_JOYY_VALUE){
			 if (s.packet_index < 2) return; 
			 parent.joyY = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SWITCH_ALLBUTTON_STATUS){
			 if (s.packet_index < 1) return;
			 for(var i=0; i < 5; i++){
				var sw_status = (s.packet_buffer[0] >> i) & 0x01;
				if(sw_status === 1) parent.switchStatus[i] = true;
				else parent.switchStatus[i] = false;
			 }
		  }
		  s.action = actionBranch;
		};
		
	}
	//Boolean 패치 완료
	
	function touch_block(){
		this.port= -1;
		this.touchon_btn = 0;
		this.touchoff_btn = 0;
		this.touchStatus = new Array(16);
		
		for(var i=0; i < 16; i++){
			this.touchStatus[i] = 0;		//기본값으로 모든 터치센서가 꺼진 것으로 배열을 채움
		}
		
		this.name = "touch";
		var parent = this;
		
		this.parser = function(rb) {
		s.packet_buffer[s.packet_index++] = rb;
		
		  if (s.detail === s.TOUCH_BUTTON_OFF){
			 if (s.packet_index < 1) return;
			 parent.touchoff_btn = s.packet_buffer[0];
		  }else if (s.detail === s.TOUCH_BUTTON_ON){
			 if (s.packet_index < 1) return;
			 parent.touchon_btn = s.packet_buffer[0];
		  }else if (s.detail === s.TOUCH_ALLBUTTON_STATUS){
			 if (s.packet_index < 2) return;
			 for(var i=0; i < 12; i++){
				 var touch_bit = s.packet_buffer[0] + s.packet_buffer[1] * 256;
				var touch_status =  ((touch_bit) >> i )& 0x0001;
				if(touch_status === 1) parent.touchStatus[i] = true;
				else parent.touchStatus[i] = false;
			 }
		  }
		  s.action = actionBranch;
		};		
	}
	//Boolean 패치 완료
	
	function motion_block(){
		this.port= -1;
		this.infrared1 = 0;
		this.infrared2 = 0;
		this.infrared3 = 0;
		this.accelerX = 0;
		this.accelerY = 0;
		this.accelerZ = 0;
		this.paccelerU = 0;
		this.paccelerV = 0;
		this.paccelerW = 0;
		this.photo1_on = 0;
		this.photo1_off = 0;
		this.photo2_on = 0;
		this.photo2_off = 0;
		this.photo1_on_time = 0;		
		this.photo1_off_time = 0;		
		this.photo2_on_time = 0;		
		this.photo2_off_time = 0;		
		this.photoStatus1 = 0;
		this.photoStatus2 = 0;

		this.name = "motion";

		var parent = this;
		
		this.parser = function(rb) {
			//console.log("motion started");
			s.packet_buffer[s.packet_index++] = rb;				
			//console.log("s.detail " + s.detail);
		  if (s.detail === s.MOTION_IR_VALUE){
			  if (s.packet_index < 6) return;
			  parent.infrared1 = s.packet_buffer[0] + s.packet_buffer[1] * 256;
			  parent.infrared2 = s.packet_buffer[2] + s.packet_buffer[3] * 256;
			  parent.infrared3 = s.packet_buffer[4] + s.packet_buffer[5] * 256;
			  //console.log("IR finshed and " + parent.infrared1);
			  s.action = actionBranch;
		  }else if (s.detail === s.MOTION_ACCEL_VALUE){
			  if (s.packet_index < 6) return;
			  parent.accelerX = s.packet_buffer[0] + s.packet_buffer[1] * 256;
			  parent.accelerY = s.packet_buffer[2] + s.packet_buffer[3] * 256;
			  parent.accelerZ = s.packet_buffer[4] + s.packet_buffer[5] * 256;
			  //console.log("ACCEL finshed");
			  s.action = actionBranch;
		  }else if (s.detail === s.MOTION_PACCEL_VALUE){
			  if (s.packet_index < 6) return;
			  parent.paccelerU = s.packet_buffer[0] + s.packet_buffer[1] * 256;
			  parent.paccelerV = s.packet_buffer[2] + s.packet_buffer[3] * 256;
			  parent.paccelerW = s.packet_buffer[4] + s.packet_buffer[5] * 256;
			  //console.log("PACCEL finshed");
			  s.action = actionBranch;
		  }else if ((s.detail === s.MOTION_PHOTO1_ON)){
			  if (s.packet_index < 4) return;
			  parent.photo1_on = true;
			  parent.photo1_on_time = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
			  s.action = actionBranch;
		  }else if ((s.detail === s.MOTION_PHOTO1_OFF)){
			  if (s.packet_index < 4) return;
			  parent.photo1_off = true;
			  parent.photo1_off_time = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
			  s.action = actionBranch;
		  }else if ((s.detail === s.MOTION_PHOTO2_ON)){
			  if (s.packet_index < 4) return;
			  parent.photo2_on = true;
			  parent.photo2_on_time = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
			  s.action = actionBranch;
		  }else if ((s.detail === s.MOTION_PHOTO2_OFF)){
			  if (s.packet_index < 4) return;
			  parent.photo2_off = true;
			  parent.photo2_off_time = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
			  s.action = actionBranch;
		  }else if (s.detail === s.MOTION_ALLPHOTO_STATUS){
			 if (s.packet_index < 1) return;
			 parent.photoStatus1 = (s.packet_buffer[0] & 0x01);
			 parent.photoStatus2 = (s.packet_buffer[0] & 0x01) >> 1;
			 s.action = actionBranch;
		  }
		  
		};
	}

	function checkVersion(rb){
		s.packet_buffer[s.packet_index++] = rb;
		//console.log("s.packet_buffer[" + s.packet_index + "] " + s.packet_buffer[s.packet_index]);
		//s.packet_index++		
		
			
		//console.log('I am comming processSysexMessage SCBD_CHOCOPI_USB');
		if(s.packet_index === 9){
			if (!connected) {
			  clearInterval(poller);		//setInterval 함수는 특정 시간마다 해당 함수를 실행
			  poller = null;				//clearInterval 함수는 특정 시간마다 해당 함수를 실행하는 것을 해제시킴
			  clearTimeout(watchdog);
			  watchdog = null;				//감시견을 옆집 개나줘버림
			  connected = true;

			  setTimeout(init, 200);
			  sysexBytesRead = 0;	
			  send2byteCommand(SCBD_CHOCOPI_USB, CPC_GET_BLOCK);
			}
			pinging = false;
			pingCount = 0;	
			setVersion(s.packet_buffer[7], s.packet_buffer[8]);
			s.action = actionBranch;
			return;
		}
	}
	
	function checkPing(){
		console.log("ping received");		
		if (!connected) {
		  clearInterval(poller);		
		  poller = null;				
		  clearTimeout(watchdog);
		  watchdog = null;				
		  connected = true;

		  setTimeout(init, 200);			
		  sysexBytesRead = 0;		
		}
		pinging = false;
		pingCount = 0;
		s.action = actionBranch;
		return;	
	}

	function actionBranch(rb){
		s.packet_index = 0;
		if (rb < 0xE0){
			console.log("Header Data for block " + rb.toString(16));			
			s.detail = rb & 0xF0;
			s.port = rb & 0x0F;
			s.action = s.blockList[s.port].parser;	//각 블록의 해당함수 파서에게 뒷일을 맡김.
		}else{
			console.log("Header Data for Chocopi " + rb.toString(16));
			s.action = actionChocopi;
			if(rb === SCBD_CHOCOPI_USB_PING) checkPing();	//PING 의 경우 헤더가 도착하지 않기 때문에, 여기서 판별함
			if (rb === (SCBD_CHOCOPI_USB | 0x01)){
				s.action = checkConnect;	//하드웨어 연결시에도 헤더가 도착하지 않음.
			}else if (rb === (SCBD_CHOCOPI_USB | 0x02)){
				s.action = checkRemove;
			}else if (rb === (SCBD_CHOCOPI_BLE | 0x03)){	//BLE 연결 상태에 대한 정의
				s.action = bleChanged;
			}else if(rb === (SCBD_CHOCOPI_USB | 0x0F)){		//에러코드에 대한 정의
				s.action = reportError;
			}
		}
		//console.log("action is" + s.action );
		return;
	}
	
	function reportError(rb){
		s.packet_buffer[s.packet_index++] = rb;
		if (s.packet_index === 10){
			console.log("에러발생 오류코드 : " + s.packet_buffer[0] + s.packet_buffer[1] );	
			console.log("데이터 : " + s.packet_buffer[2] + s.packet_buffer[3] + s.packet_buffer[4] + s.packet_buffer[5] + s.packet_buffer[6] + s.packet_buffer[7] + s.packet_buffer[8] + s.packet_buffer[9]);
			//오류코드 (2 Byte), 참고데이터 (8 Byte)
			s.action = actionBranch;
		}
		return;
	}

	function actionChocopi(rb){
		s.packet_index=0; //start from 	
		console.log("rb is " + rb);	
		if(rb === CPC_VERSION)
			s.action=checkVersion;
		if(rb === CPC_GET_BLOCK)
			s.action=actionGetBlock;
		return;
	}

	function bleChanged(rb){
		if (rb === 0){	//연결해제
			for (var i=8; i < 16; i++){							//STATUS (inputData, storedInputData)
				disconectBlock(i);									//2016.04.30 재패치
			}
			console.log("BLE is disconnected");
		}else if (rb === 1){
			console.log("BLE is connected");
		}	
		s.action = actionBranch;	
		return;
	}

	function checkRemove(rb){
		disconectBlock(rb);	// PORT	(inputData, storedInputData)		inputData[0] 번이 0xE2 인 경우, 이어서 포트(1 Byte) 가 전송됨
		console.log("Removed block port " + rb);
		s.action = actionBranch;
		return;
	}
	
	function checkConnect(rb){
		s.packet_buffer[s.packet_index++] = rb;
		if (s.packet_index === 3){
			var block_type = s.packet_buffer[1] + s.packet_buffer[2]*256 ,
			connected_port = s.packet_buffer[0];
			connectBlock(block_type, connected_port);
			//PORT, BLOCK_TYPE(LOW), BLOCK_TYPE(HIGH)	(inputData)
			console.log("block_type is" + block_type + " connected into port " + connected_port);
			s.action = actionBranch;
		}
		return;
	}
	
	function actionGetBlock(rb){
		// detail/port, CPC_GET_BLOCK 를 제외한 포트가 LOW 8 Bit, HIGH 8 Bit 순으로 등장함
		s.packet_buffer[s.packet_index++] = rb;
		var rp = 0;
		if(s.packet_index <32) return;
		for (var port = 0 ; port < 16; port++){
			var block_type = s.packet_buffer[rp++];
				block_type += s.packet_buffer[rp++]*256;						
			connectBlock(block_type, port);	
		}
		s.action = actionBranch;
		return;
	}
	
	function processInput(inputData) {
		  //입력 데이터 처리용도의 함수
		if(s.action==null){
			//inittialize all values		
			s.action=actionBranch;
			s.packet_buffer = new Array(1024);
			s.blockList = new Array(16);
			
			for(var i=0; i < 16; i++){
				s.blockList[i] = new nullBlock();
			}
		}
		
		var isEscaping = false;
		var i=0;
		var rb=0;
		for (var ri in  inputData){
//			s.action(inputData[rb]);	
			rb=inputData[ri];
			if(rb === START_SYSEX){
				s.action=actionBranch;
			}else{				
				if(rb==0x7D){
					isEscaping=true;
				}else{
					if(isEscaping === true){
						rb=rb ^ 0x20;
					}
					isEscaping=false;
					console.log("D[" + (i++) + "] " + rb.toString(16));
					s.action(rb);	
					
				}
			}
		}
	}

//-------------------------------------------------------------------SAMPLING FUNCTION START -- 2016.05.11 재패치 완료
	var low_data = escape_control(SAMPLING_RATE & LOW),
		high_data = escape_control(SAMPLING_RATE & HIGH);
	
	var	check_low = 0,
		check_high = 0;

	var sample_functions = {
		sensor_sender: function(port) {
			var	sensor_detail = new Uint8Array([0x40, 0x50, 0x60, 0x00, 0x10, 0x20, 0x30]);
			var	dnp = [];
			for (var i=0; i < sensor_detail.length; i++){
				dnp[i] = (sensor_detail[i] | port);
			}
			for (var i=0;i < dnp.length ; i++){
				var sensor_output = new Uint8Array([dnp[i], low_data, high_data]);
				send_array(sensor_output);
			}
		},
		// 리포터 센더 정의 완료. 터치는 센더가 없음.
		motion_sender: function(port) {
			var sensor_detail = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);	
			var	dnp = [];
			for (var i=0; i < sensor_detail.length; i++){
				dnp[i] = (sensor_detail[i] | port);
			}
			//dnp.length-1
			for (var i=0;i < dnp.length; i++){
				var motion_output = new Uint8Array([dnp[i], low_data, high_data]);
				send_array(motion_output);
				//console.log("motion_output.buffer" + motion_output.buffer);
			}
			var motion_output = new Uint8Array([ dnp[4] ]);	
				send_array(motion_output);
			//	console.log("motion_output.buffer" + motion_output.buffer);
		},
		sw_sender: function(port){
			var sensor_detail = new Uint8Array([0x10]);	
			var	dnp = [];
			dnp[0] = (sensor_detail[0] | port);
			var sw_output = new Uint8Array([dnp[0], 0x0F, low_data, high_data]);
			send_array(sw_output);
		}
	};

	//block_port_usb = {["sensor"], ["touch"], ...};	block_port_usb, block_port_ble 에는 연결된 블록에 대응하는 포트들이 담기게됨.
	//block_port_ble = {["sensor"], ["touch"], ...};	예) s.block_port_usb["sensor"] 에는 연결된 포트가 담김
	function connectBlock (block_id, port) {		// 그렇다면 s.block_port_usb["sensor"] 로 접근할경우에는 연결된 포트가 없다면 뭐가 리턴되지?	
		if(block_id === 0x00) return;				// Array map 에서 운행해서 찾지 못하는 경우에는 -1 이 false 로 떨어지는 듯 함.
		if(block_id === SCBD_SENSOR){				
			if (port < 8) s.block_port_usb["sensor"] = port;
			else s.block_port_ble["sensor"] = port;

			sample_functions.sensor_sender(port);		//SCBD_SENSOR 에 대한 샘플링 레이트 --> 2016.05.11 작성완료
			s.blockList[port] = new sensor_block();		//sensor_block 을 s.blockList[port] 에 대해서 객체선언하기 때문에 s.blockList[port].name 과 같이 접근가능
			//console.log("s.blockList[" + port + "] " + s.blockList[port].name);
		}else if (block_id === SCBD_TOUCH){				//s.blockList[port] 의 위치에는 실행가능한 함수들이 담기게됨. (parser 를 통함)
			if (port < 8) s.block_port_usb["touch"] = port;
			else s.block_port_ble["touch"] = port;
			//sample_functions.touch_sender(port);			//SCBD_TOUCH 에 대한 샘플링 레이트
			
			s.blockList[port] = new touch_block();
		}else if (block_id === SCBD_SWITCH){
			if (port < 8) s.block_port_usb["swch"] = port;
			else s.block_port_ble["swch"] = port;
			sample_functions.sw_sender(port);			//SCBD_SWITCH 에 대한 샘플링 레이트
			s.blockList[port] = new switch_block();
			console.log("i am not visible");
		}else if (block_id === SCBD_MOTION){
			if (port < 8) s.block_port_usb["motion"] = port;
			else s.block_port_ble["motion"] = port;

			sample_functions.motion_sender(port);			
			s.blockList[port] = new motion_block();		//SCBD_MOTION 에 대한 샘플링 레이트	--> 2016.05.11 작성완료
			console.log("s.blockList[" + port + "] " + s.blockList[port].name);
		}else if (block_id === SCBD_LED){
			if (port < 8) s.block_port_usb["led"] = port;
			else s.block_port_ble["led"] = port;
			
			s.blockList[port] = new led_block();
		}else if (block_id === SCBD_STEPPER){
			if (port < 8) s.block_port_usb["stepper"] = port;
			else s.block_port_ble["stepper"] = port;
			
			s.blockList[port] = new stepper_block();
		}else if (block_id === SCBD_DC_MOTOR){
			if (port < 8) s.block_port_usb["dc_motor"] = port;
			else s.block_port_ble["dc_motor"] = port;
			
			s.blockList[port] = new dc_motor_block();
		}else if (block_id === SCBD_SERVO){
			if (port < 8) s.block_port_usb["servo"] = port;		
			else s.block_port_ble["servo"] = port;
			
			s.blockList[port] = new servo_block();			
		}
		s.blockList[port].port = port;
		console.log("port:"+ port +" name :" + s.blockList[port].name + "connected !, id was " + block_id );
	}
	
	function nullBlock(){
		this.port=-1;
		this.name = "null Block";
		
		var parent = this;				//2016.05.14 추가패치
		this.parser = function(rb){
			console.log("X! on " + parent.port);
			s.action = actionBranch;
		};
	}
	
	//예) s.block_port_usb["sensor"] 에는 연결된 포트들이 담기게됨.
	function disconectBlock(port){
		return;
		
		/*
		console.log("port " + port);
		var block_name = s.blockList[port].name;
		console.log("block_name " + block_name);
		
		if (port >= 8){
			s.block_port_ble[block_name] = -1;					//s.block_port_ble["sensor"] 의 포트를 -1 로 지정
			for (var i=8; i < 16; i++){
				if (s.blockList[i].name === block_name){
					if (i !== port){
						s.block_port_ble[block_name] = i;		//블록리스트의 배열안에서 같은 이름을 가지는 녀석이 있다면
					}											//해당 포트의 이름을 가지는 블록에 포트를 배정함. (포트 재배정 예외처리)
				}												//처리하기 위해서 slice 는 사용 불가능 -> index 가 아닌 map으로써 사용되기 때문
			}
		}else{
			s.block_port_usb[block_name] = -1;
			for (var i=0; i < 8; i++){
				if (s.blockList[i].name === block_name){
					if (i !== port){
						s.block_port_usb[block_name] = i;
					}
				}
			}
		}
		console.log("disconected " + block_name + " from port" + port);
		*/
		//s.blockList[port] = new nullBlock();
		//s.blockList[port].port = -1;		//2016.05.14 추가패치
	}


//----------------------------------------------------------------------------------- SYSTEM FUNCTION LINE 
  	ext._getStatus = function() {
			if(!connected) return {status: 1, msg: 'ChocopieBoard disconnected'};
			else return {status: 2, msg: 'ChocopieBoard connected'};	
			if(watchdog) return {status: 1, msg: 'Probing for ChocopieBoard'};
	};
			

  ext._deviceRemoved = function(dev) {
    console.log('Device removed');
    // Not currently implemented with serial devices
  };

  var potentialDevices = [];
  ext._deviceConnected = function(dev) {
    potentialDevices.push(dev);
    if (!device)
      tryNextDevice();
  };

  var poller = null;
  var watchdog = null;

  function tryNextDevice() {
    device = potentialDevices.shift();
    if (!device) return;

    device.open({ stopBits: 0, bitRate: 115200, ctsFlowControl: 0 });
    console.log('Attempting connection with ' + device.id);
    device.set_receive_handler(function(data) {
      var inputData = new Uint8Array(data);
      processInput(inputData);
    });
	//첫째로 processInput 핸들러를 가동시키고 나서

    poller = setInterval(function() {
      queryFirmware();
    }, 1000);
	//queryFirmware 를 가동시킴으로써 시스템 쿼리펌웨어에 대하여 메세지 확정처리르 거침

    watchdog = setTimeout(function() {
      clearInterval(poller);
      poller = null;
      device.set_receive_handler(null);
      device.close();
      device = null;
      tryNextDevice();
    }, 5000);
	// 5초마다 지속적으로 tryNextDevice 를 실행해줌으로써, 연결될때까지 무한루프를 가동하게됨
  }

  ext._shutdown = function() {
    // TODO: Bring all pins down
    if (device) device.close();
    if (poller) clearInterval(poller);
    device = null;
  };	
	//Function added Line -----------------------------------------------------------------------------	

	//reportSensor 에 대하여 검증필요->내용 확인 완료 (light Sensor 또한 Analog) -- Changed By Remoted 2016.04.14
	ext.reportSensor = function(networks, hwIn){
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["sensor"];
		}else{
			port = s.block_port_ble["sensor"];		//무선
		}

		if (port === -1) return;
		var object = s.blockList[port];

		if (hwIn === menus[lang]['hwIn'][0]) return object.temperature;
		if (hwIn === menus[lang]['hwIn'][1]) return object.humidity;
		if (hwIn === menus[lang]['hwIn'][2]) return object.light;
		if (hwIn === menus[lang]['hwIn'][3]) return object.analog_sensor1;
		if (hwIn === menus[lang]['hwIn'][4]) return object.analog_sensor2;
		if (hwIn === menus[lang]['hwIn'][5]) return object.analog_sensor3;
		if (hwIn === menus[lang]['hwIn'][6]) return object.analog_sensor4;
		
	};
	//2016.05.11 재구성에 따른 간소화패치 완료

	ext.isTouchButtonPressed = function(networks, touch){	//이벤트성 터치블록이 아닌, 일반 터치블록
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["touch"];
		}else{
			port = s.block_port_ble["touch"];		//무선
		}

		if (port === -1) return;
		var object = s.blockList[port];

		for(var i=0; i < 12; i++){
			if (hwIn === menus[lang]['touch'][i]) return object.touchStatus[i];	//1번부터 12번 터치센서까지 순서대로 다다다다다
		}	
	};
	//2016.05.11 재구성에 따른 간소화패치 완료

	ext.whenTouchButtonChandged = function(networks, touch, btnStates){	//이벤트성 터치블록
		var port = 0;
		
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["touch"];
		}else{
			port = s.block_port_ble["touch"];		//무선
		}
		
		if (port === -1) return;
		var object = s.blockList[port];
		
		var touch_functions = {
			touchOn: function() {
				if(object.touchon_btn === touch)
					return true;
			},
			touchOff: function(){
				if(object.touchoff_btn === touch)
					return false;
			}
		};
		
		if(btnStates === 1)	touch_functions.touchOn();
		else touch_functions.touchOff();
	};
	//2016.05.11 재구성에 따른 간소화패치 완료

	
	ext.whenButton = function(networks, sw, btnStates) {
		//스위치 hat 블록에 대한 함수
		var port = 0;
		
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["swch"];
		}else{
			port = s.block_port_ble["swch"];		//무선
		}
		
		if (port === -1) return false;
		var object = s.blockList[port];			
		
		
		if(btnStates === 1)	{
			for(var i=0; i < 5; i++){
				if(sw === menus[lang]['sw'][i]){
					if(object.switchon_btn[i+1]){
						object.switchon_btn[i+1]=false;
						return true;
					}							
				}
			}
		}			
		else {
			for(var i=0; i < 5; i++){
				if(sw === menus[lang]['sw'][i]){
					if(object.switchoff_btn[i+1]){
						object.switchoff_btn[i+1]=false;
						return true;
					}							
				}
			}
		}
			
	};
	
	ext.isSwButtonPressed = function(networks, sw){
		//Boolean Block		
		var port = 0;
		
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["swch"];
		}else{
			port = s.block_port_ble["swch"];		//무선
		}
		
		if (port === -1) return;
		var object = s.blockList[port];
		
		for(var i=0; i < 5; i++){
			if(sw === menus[lang]['sw'][i])
				return object.switchStatus[i];
		}
	};
	//2016.05.01 스위치 블록 boolean 패치에 따라서 생겨난 함수
	//2016.05.13 Boolean 패치 완료
	
	ext.reportJogValue = function(networks, buttons){
		// 조이스틱X, 조이스틱Y, 포텐시오미터
		var port = 0;
		
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["swch"];
		}else{
			port = s.block_port_ble["swch"];		//무선
		}
		
		if (port === -1) return;
		var object = s.blockList[port];	
		
		if( menus[lang]['buttons'][0] ) return object.joyX;
		if( menus[lang]['buttons'][1] ) return object.joyY;
		if( menus[lang]['buttons'][2] ) return object.potencyometer;
	};
	//REPOTER PATCH CLEAR

	ext.motionbRead = function(networks, motionb){
		//console.log('motionbRead is run');
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["motion"];
		}else{
			port = s.block_port_ble["motion"];		//무선
		}
		//console.log("port " + port);
		if (port === -1) return;
		var object = s.blockList[port];
		
		/*
		console.log("object name " + object.name);
		console.log("object.infrared1 " + object.infrared1);
		console.log("object.infrared2 " + object.infrared2);
		console.log("object.infrared3 " + object.infrared3);
		*/
		if (motionb === menus[lang]['motionb'][0]) return object.infrared1;
		if (motionb === menus[lang]['motionb'][1]) return object.infrared2;
		if (motionb === menus[lang]['motionb'][2]) return object.infrared3;
		if (motionb === menus[lang]['motionb'][3]) return object.accelerX;
		if (motionb === menus[lang]['motionb'][4]) return object.accelerY;
		if (motionb === menus[lang]['motionb'][5]) return object.accelerZ;
		if (motionb === menus[lang]['motionb'][6]) return object.paccelerU;	
		if (motionb === menus[lang]['motionb'][7]) return object.paccelerV;	
		if (motionb === menus[lang]['motionb'][8]) return object.paccelerW;	
		if (motionb === menus[lang]['motionb'][9]) return object.photoStatus1;	
		if (motionb === menus[lang]['motionb'][9]) return object.photoStatus2;	
	};
	//2016.05.11 재구성에 따른 간소화패치 완료

	ext.photoGateRead = function(networks, photoGate ,gateState){		//이벤트성 포토게이트 hat블록에 이어짐
		//console.log('photoGateRead is run');	
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["motion"];
		}else{
			port = s.block_port_ble["motion"];		//무선
		}

		if (port === -1) return;
		var object = s.blockList[port];
	
		if( photoGate === menus[lang]['photoGate'][0] ){
			if (gateState === menus[lang]['gateState'][1]){
				if(object.photo1_on){
					object.photo1_on=false;
					return true;
				} 
				return false;
			} 
			if(gateState === menus[lang]['gateState'][0]){	//포토게이트 1번 막힐때
				if(object.photo1_off){
					object.photo1_off = false;
					return true;
				}	
			}
		}else if (photoGate === menus[lang]['photoGate'][1]){	//포토게이트 2번 열릴때
			if (gateState === menus[lang]['gateState'][1]){
				if(object.photo2_on){
					object.photo2_on = false;
					return true;
				}
			} 
			if (gateState === menus[lang]['gateState'][0]){		//포토게이트 2번 막힐때
				if(object.photo2_off){
					object.photo2_off = false;
					return true;
				}
			}					
		}						
	};
	//2016.05.11 재구성에 따른 간소화패치 완료
	//2016.05.13 Boolean 패치 완료

	ext.passLEDrgb = function(networks, ledPosition, r, g, b){
		//console.log('passLEDrgb is run');
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["led"];
		}else{
			port = s.block_port_ble["led"];		//무선
		}
		if (port === -1) return;
		
		port = 0x10| port;
		var led_output = new Uint8Array([port , ledPosition,r,g,b]);		
			send_array(led_output);
		
	};
	//LED는 수신데이터가 없음.. 오로지 설정뿐

	ext.passBUZEER = function(networks, pitch, playtime){
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["led"];
		}else{
			port = s.block_port_ble["led"];		//무선
		}

		if (port === -1) return;
		port= 0x80| port;
		var data = new Uint8Array([port, pitch]);
		for(var i=0;i<4;i++){			
			data[data.length]=playtime & 0xFF;
			playtime>>=8;
		} 
		send_array(buzzer_output);
		
		
	};

	ext.passSteppingAD = function(networks, steppingMotor, speed, stepDirection){
		//console.log('passSteppingAD is run');
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["stepper"];
		}else{
			port = s.block_port_ble["stepper"];		//무선
		}

		if (port === -1) return;
		var d=0, isDirectionCW; 
		
		var speed_data = speed,
			motor_data = dec2hex(steppingMotor);

		if (stepDirection === menus[lang]['stepDirection'][0]){	//시계방향
			isDirectionCW = true;
			if (speed_data > 1023)	speed_data = 1023;		//데이터 보정
			if (speed_data < -1023)	speed_data = -1023;		//데이터 보정
		}else if (stepDirection === menus[lang]['stepDirection'][1]){	//반시계방향
			isDirectionCW = false;
			speed_data = speed_data * -1;
			if (speed_data > 1023)	speed_data = 1023;		//데이터 보정
			if (speed_data < -1023)	speed_data = -1023;		//데이터 보정
		}
		if(speed_data<0 ){
			speed_data = -speed_data;
			isDirectionCW = (isDirectionCW) ?false : true;
		}
		d = (isDirectionCW) ? 0x00:0x10;
		d |= port;
		var data = new Int8Array([d, speed_data]);		
			data[data.length]=speed & 0xFF;	speed_data>>=8;
			data[data.length]=speed & 0xFF ; //생각해조 
		send_array(data);

	};

	ext.passSteppingADA = function(networks, steppingMotor, speed, stepDirection, rotation_amount){
		//console.log('passSteppingADA is run');
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["stepper"];
		}else{
			port = s.block_port_ble["stepper"];		//무선
		}

		if (port === -1) return;
		var d=0, isDirectionCW; 
		
		var speed_data = speed,
			motor_data = dec2hex(steppingMotor);

		if (stepDirection === menus[lang]['stepDirection'][0]){	//시계방향
			isDirectionCW = true;
			if (speed_data > 1023)	speed_data = 1023;		//데이터 보정
			if (speed_data < -1023)	speed_data = -1023;		//데이터 보정
		}else if (stepDirection === menus[lang]['stepDirection'][1]){	//반시계방향
			isDirectionCW = false;
			speed_data = speed_data * -1;
			if (speed_data > 1023)	speed_data = 1023;		//데이터 보정
			if (speed_data < -1023)	speed_data = -1023;		//데이터 보정
		}
		if(speed_data<0 ){
			speed_data = -speed_data;
			isDirectionCW = (isDirectionCW) ?false : true;
		}
		d = (isDirectionCW) ? 0x20:0x30;
		d |= port;
		var data = new Int8Array([d, speed_data]);		
			data[data.length]=speed & 0xFF;	speed_data>>=8;
			data[data.length]=speed & 0xFF ; //생각해조 
		
		data[data.length]=rotation_amount & 0xFF;	rotation_amount_data>>=8;
		data[data.length]=rotation_amount & 0xFF;	rotation_amount_data>>=8;
		data[data.length]=rotation_amount & 0xFF;	rotation_amount_data>>=8;
		data[data.length]=rotation_amount & 0xFF;	rotation_amount_data>>=8;		
		
		send_array(data);
	};

	ext.passDCAD = function(networks, dcMotor, speed, stepDirection){
		//console.log('passDCAD is run');
		var port = 0;
		if (networks === menus[lang]['networks'][0]){		//일반
			port = s.block_port_usb["dc_motor"];
		}else{
			port = s.block_port_ble["dc_motor"];		//무선
		}

		if (port === -1) return;
		var sensor_detail = new Uint8Array([0x10, 0x20, 0x30]);
		var	dnp = [];
		
		for(var i=0; i < 3; i++){
			dnp[i] = (sensor_detail[i] | port);	
		}
		
		var speed_data = speed,
			direction_data = 0;
		
		if(speed > 1024){
			speed_data = 1024;
		}else if (speed < 0){
			speed_data = 0;
		}

		if (stepDirection === menus[lang]['stepDirection'][0])
			direction_data = 1;	//시계
		else
			direction_data = 0;	//반시계
			
		var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
			speed_data_high = escape_control(dec2hex(speed_data) & HIGH),
			merged_data = (speed_data_low * 256 * 256) + (speed_data_high * 256) + dec2hex(direction_data);

		for (var i=0; i < 3; i++ ){
			if (dcMotor === menus[lang]['dcMotor'][i]){				
			var check_merged_data = checkSum( dnp[i], merged_data ),
				DCAD_output = new Uint8Array([START_SYSEX, dnp[i], merged_data, check_merged_data, END_SYSEX]);	

				device.send(DCAD_output.buffer);
			}
		}		
	};

	ext.rotateServo = function(networks, servosport, servos, degree) {
		console.log('rotateServo is run');
		
		//if (port < 8) s.servo_block_usb[s.servo_count_usb++] = port;		//만약 "servo" 에 이미 데이터가 존재하는 경우에는 port가 덮어씌워질 듯 하다
		//else s.servo_block_ble[s.servo_count_ble++] = port;				//패치 완료
		
		var port = 0;
		port = servosport-1;	

		if (networks === menus[lang]['networks'][0]){		//일반
			if(s.blockList[port].name!=="servo"){
				port =s.block_port_usb["servo"];
			}
		}else{						
			if(s.blockList[port].name!=="servo"){			//무선
				port =s.block_port_ble["servo"];
			}
		}
		
		if (port === -1) return;		//일반일때도, 무선일때도, servo 의 갯수가 하나도 없다면 되돌림
		var sensor_detail = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
		console.log("port " + port);


		if (degree > 180){
			degree = 180;
		}else if(degree < 0){
			degree = 0;
		}
		
		degree*=100; //

		var	d = 0;
		var output= new Uint8Array(3);
		for(var j=0; j < 4; j++){
			d = sensor_detail[j] | port ;		//dnp 배열에는 디테과 연결된 서보블록들에 대한 것이 저장됨			
			output[0]=d;
			if (servos === menus[lang]['servos'][j]){
			for(var i=0;i<2;i++){			
				output[i+1]=degree & 0xFF;
				degree>>=8;
			}			
			send_array(output);
			console.log("Servo Port " + port + "is querySend! from detail " + sensor_detail[j]);
			}
		}								
	};

	//Function added Line - end  --------------------------------------------------------------------------------------

	
  // Check for GET param 'lang'
  var paramString = window.location.search.replace(/^\?|\/$/g, '');
  var vars = paramString.split("&");
  var lang = 'en';
  for (var i=0; i<vars.length; i++) {
    var pair = vars[i].split('=');
    if (pair.length > 1 && pair[0]=='lang')
      lang = pair[1];
  }

  var blocks = {
    en: [
      ['r', 'read from %m.networks to %m.hwIn', 'reportSensor', 'normal','temperature sensor'],		//light, temperature, humidity and analog sensor combined (normal, remote)
      ['-'],																						//function_name: reportSensor
	  ['r', '%m.networks touch sensor %m.touch is pressed?', 'isTouchButtonPressed', 'normal', 1],		//Touch Sensor is boolean block (normal, remote)
	  ['h', 'when %m.networks touch sensor %m.touch is %m.btnStates', 'whenTouchButtonChandged', 'normal', 1, 0],		//function_name : isTouchButtonPressed	whenTouchButtonChandged
      ['-'],
      ['h', 'when %m.networks sw block %m.sw to %m.btnStates', 'whenButton', 'normal', 'Button 1', 0],	//sw block (button 1, .. )		function_name :
      ['r', '%m.networks sw block %m.buttons of value', 'reportJogValue', 'normal','Joystick X'],			//buttons ( button 1, 2, 3, 4)	whenButton
	  ['b', '%m.networks sw block %m.sw of value', 'isSwButtonPressed', 'normal','Button 1'],					//Joystick and Potencyometer	reportJogValue
	  ['-'],																									
	  ['r', '%m.networks motion-block %m.motionb of value', 'motionbRead', 'normal','infrared 1'],								//Motion block is infrared, acceler and so on
	  ['h', 'when %m.networks motion-block %m.photoGate is %m.gateState', 'photoGateRead', 'normal', 'photoGate 1', 'blocked'],	//function_name : motionbRead	photoGateRead	
	  ['-'],
	  [' ', '%m.networks LED LOCATION %n RED %n GREEN %n BLUE %n', 'passLEDrgb', 'normal', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
	  [' ', '%m.networks BUZZER PITCH %n DURATION %n seconds', 'passBUZEER', 'normal', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
	  ['-'],
	  [' ', '%m.networks %m.steppingMotor Stepping Motor Accel %n Direction %m.stepDirection', 'passSteppingAD', 'normal', 1, 0, 'clockwise'],
	  [' ', '%m.networks %m.steppingMotor Stepping Motor Accel %n Direction %m.stepDirection Angle %n', 'passSteppingADA', 'normal', 1, 0, 'clockwise', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
	  ['-'],
	  [' ', '%m.networks %m.dcMotor DC Motor Accel %n Direction %m.stepDirection', 'passDCAD', 'normal', 1, 0, 'clockwise'],
	  ['-'],
	  [' ', '%m.networks Port %m.servosport %m.servos to %n degrees', 'rotateServo', 'normal', 1, 'Servo 1', 90]
    ],
    ko: [																						
      ['r', '%m.networks 센서블록 %m.hwIn 의 값', 'reportSensor', '일반', '온도'],										// 조도, 온도, 습도, 아날로그 통합함수 (일반, 무선)
      ['-'],																											// function_name = reportSensor
	  ['r', '%m.networks 터치센서 %m.touch 의 값', 'isTouchButtonPressed', '일반', 1],									//Touch Sensor is boolean block	-- normal and remote					
	  ['h', '%m.networks 터치센서 %m.touch 가 %m.btnStates 가 될 때', 'whenTouchButtonChandged', '일반', 1, 0],		//function_name : isTouchButtonPressed	whenTouchButtonChandged
	  ['-'],																											//function_name : isTouchButtonPressed 
      ['h', '%m.networks 스위치블록 %m.sw 이 %m.btnStates 될 때', 'whenButton', '일반', '버튼 1', 0],				//sw block (button 1, .. )
      ['r', '%m.networks 스위치블록 %m.buttons 의 값', 'reportJogValue', '일반','조이스틱 X'],							//buttons ( button 1, 2, 3, 4, J)				
	  ['b', '%m.networks 스위치블록 %m.sw 의 값', 'isSwButtonPressed', '일반','버튼 1'],							//Joystick and Potencyometer function is combined.
	  ['-'],																										//function_name :  reportJogValue	whenButton
	  ['r', '%m.networks 모션블록 %m.motionb 의 값', 'motionbRead', '일반','적외선 감지 1'],								//Motion block is infrared, acceler and so on
	  ['h', '%m.networks 모션블록 %m.photoGate 가 %m.gateState', 'photoGateRead', '일반', '포토게이트 1', '막힐때'],	//function_name : motionbRead	photoGateRead	
	  ['-'],																	//LED RGB definition
	  [' ', '%m.networks LED블록 위치 %n 빨강 %n 녹색 %n 파랑 %n', 'passLEDrgb', '일반', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
	  [' ', '%m.networks 버저 음높이 %n 연주시간 %n 밀리초', 'passBUZEER', '일반', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
	  ['-'],
	  [' ', '%m.networks %m.steppingMotor 번 스테핑모터 속도 %n 방향 %m.stepDirection', 'passSteppingAD', '일반', 1, 0, '시계'],
	  [' ', '%m.networks %m.steppingMotor 번 스테핑모터 속도 %n 방향 %m.stepDirection 회전량 %n', 'passSteppingADA', '일반', 1, 0, '시계', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
	  ['-'],																											//DC motor is defined
	  [' ', '%m.networks %m.dcMotor 번 DC모터 속도 %n 방향 %m.stepDirection', 'passDCAD', '일반', 1, 0, '시계'],		//function_name : passDCDA passRDCDA	
	  ['-'],
	  [' ', '%m.networks 포트 %m.servosport %m.servos 각도 %n', 'rotateServo', '일반',  1, '서보모터 1', 90]	//ServoMotor, Multiple Servo and Remote Servo is defined.
    ]
  };

  var menus = {
    en: {
		networks: ['normal', 'remote'],
		buttons: ['Joystick X', 'Joystick Y', 'Potencyometer'],
		sw: ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button J'],
		//Buttons, Joystick sensor and potencyometer sensor listing

		btnStates: [0, 1],
		//0 : pressed  1: released

		hwIn: [ 'temperature sensor', 'humidity sensor', 'light sensor', 'Analog 1', 'Analog 2', 'Analog 3', 'Analog 4'],						
		//Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added

		outputs: ['on', 'off'],
		ops: ['>', '=', '<'],
		servos: ['Servo 1', 'Servo 2', 'Servo 3', 'Servo 4'],

		servosport: [1, 2, 3, 4, 5, 6, 7, 8],

		touch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		// Touch sensor and Remoted touch sensor listing
	
		motionb: ['infrared 1', 'infrared 2', 'infrared 3', 
			'acceler X', 'acceler Y', 'acceler Z', 
			'pacceler U', 'pacceler V', 'pacceler W', 
			'photoGate 1', 'photoGate 2'],
		photoGate: ['photoGate 1', 'photoGate 2'],
		gateState: ['blocked','opened'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: [1, 2],
		stepDirection:['clockwise','declockwise'],
		//steppingMotor is defined.

		dcMotor: [1, 2, 3]
		//dcMotor is defined.

    },
    ko: {
		networks: ['일반', '무선'],
		buttons: ['조이스틱 X', '조이스틱 Y', '포텐시오미터'],
		sw : ['버튼 1', '버튼 2', '버튼 3', '버튼 4', '버튼 J'],
		//Joystick sensor and potencyometer sensor listing

		btnStates: [0, 1],
		// 0 : 눌림  1 : 떼짐

		hwIn: ['온도', '습도','조도','아날로그 1', '아날로그 2', '아날로그 3', '아날로그 4'],
		// light, temperature and humidity and Analog Sensor for 1, 2, 3 and 4 is defined.

		outputs: ['켜기', '끄기'],
		ops: ['>', '=', '<'],
		servos: ['서보모터 1', '서보모터 2', '서보모터 3', '서보모터 4'],
		servosport: [1, 2, 3, 4, 5, 6, 7, 8],

		touch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		// Touch sensor listing

		motionb: ['적외선 감지 1', '적외선 감지  2', '적외선 감지  3', 
			'가속도 X', '가속도 Y', '가속도 Z', 
			'각가속도 U', '각가속도 V', '각가속도 W', 
			'포토게이트 1', '포토게이트 2'],
		photoGate: ['포토게이트 1', '포토게이트 2'],
		gateState: ['막힐때','열릴때'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: [1, 2],
		stepDirection:['시계','반시계'],
		//steppingMotor is defined.

		dcMotor: [1, 2, 3]
		//dcMotor is defined.
    }
  };

  var descriptor = {
    blocks: blocks[lang],
    menus: menus[lang],
    url: 'http://remoted.github.io/scratch-chocopie-extension'    
  };

  ScratchExtensions.register('ChocopiBoard', descriptor, ext, {type:'serial'});

})({});
