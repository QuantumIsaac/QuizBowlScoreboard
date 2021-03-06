'use strict'

//Angular side of everything

var App = angular.module('scoreboard', [] );
App.controller('ScoreBoard_Ctrl', ScoreBoard_Ctrl);

App.directive( 'ngContextMenu', function($parse){
	return function( scope, element, attrs ){
		var fn = $parse( attrs.ngContextMenu );
		element.bind( 'contextmenu', function( event ){
			scope.$apply(function(){
				if( event.preventDefault ){
					event.preventDefault();
				}else if( event.stopPropagation ){
					event.stopPropagation();
				}else{
					event.cancelBubble = true;
				}
				fn( scope, {$event:event} );
			})
		});
	};
});

function ParseQueryString( qs ){
	qs = qs.substring(1);
	var values = qs.split( '&' );

	var query = {};
	values.forEach( function(item){
		var components = item.split('=');

		var key   = components[0];
		var value = decodeURIComponent(components[1]);

		query[key] = value;
	});

	return query;
}

function q(qu){
	return document.querySelector( qu );
}

var query = ParseQueryString( location.search );

//------ Actually Relevent Stuff ------//

var socket;
var Commander;

function ScoreBoard_Ctrl( $scope, $http, $sce, $timeout ){
	var input_pwd = "";
	var correct_pwd = "";

	$scope.Settings = {
		GameTime: new RoundTime( 15 ),
		TossupTime: new RoundTime( 0, 10 ),
		BonusTime:  new RoundTime( 0, 20 ),
		DoResults: false
	};

	$scope.GameStarted = false;

	$scope.Properties = {
		Title: 'QB',
		Room: 'Room',
		Email: 'recipient@example.com',
		Phone: ''
	};
	$scope.Property = 'Room';
	$scope.CurrentTeam = 'Team1';

	$scope.PropertySetter = {
		Property: 'Room'
	};

	$scope.ShowPropertySetter = function( property ){
		$scope.PropertySetter.Property = property;
		Application.PropertySetter.show();
		Application.PropertySetter.Box.focus();

		Application.PropertySetter.Box.select();
	};
	$scope.ShowTeamSetter = function( team ){
		$scope.CurrentTeam = team;
		Application.TeamSetter.show();
		Application.TeamSetter.Box.focus();
		
		Application.TeamSetter.Box.select();
	};

	$scope.RoundTime = RoundTime;

	$scope.Constants = Constants;

	$scope.FillZeros = fill_zeros;

	$scope.Instructions = $sce.trustAsHtml("Could not retrieve instructions.");
	var response = $http.get('js/data/Instructions.txt');

	response.success( function( data ){
		$scope.Instructions = $sce.trustAsHtml( data );
	} );

	var host = GLOBALS.SOCKET.test_host;

	socket = new WebSocket( GLOBALS.SOCKET.protocol + '://' + host + ':' + GLOBALS.SOCKET.port );

	$scope.Error = "";
	$scope.SuccessMsg = "";

	socket.onmessage = function(msg){
		var data = Commander.Parse( msg.data );

		var inst = data.getInstruction();

		var response_to = data.for;

		ProgressDialog.close();

		if( inst === "OK" ){
			if( response_to == "login" ){
				Application.SuccessDialog.show();
				var gid = parseInt(data.gid);
				var cid = parseInt(data.cid);
				var cnm = data.cnm;

				$scope.SuccessMsg = "Your GID is " + gid + ". Make sure to remember this in case of emergency, so that you can recover your data.";

				$scope.Game.GID = gid;
				$scope.Game.CID = cid;
				$scope.Game.GameStarted = true;
				correct_pwd = input_pwd;

				$scope.Properties.Title = cnm;

				if( !$scope.$$phase ){
					$scope.$digest();
				}
			}else if( response_to == "finalizing" ){
				$scope.Game.Reset();
				$scope.Game.GameStarted = false;
			}else if( response_to == "recover" ){
				var t1s  = parseInt( data.T1S ) || 0;
				var t2s  = parseInt( data.T2S ) || 0;
				var t1n  = data.T1N;
				var t2n  = data.T2N;
				var gid  = data.gid;
				var cid  = data.cid;
				var room = data.room;
				var cnm  = data.cnm;

				$scope.Game.GID = gid;
				$scope.Game.CID = cid;
				$scope.Game.GameStarted = true;

				$scope.Game.Team1.setScore( t1s );
				$scope.Game.Team2.setScore( t2s );

				$scope.Game.Team1.setName( t1n );
				$scope.Game.Team2.setName( t2n );

				$scope.Properties.room  = room;
				$scope.Properties.Title = cnm;

				Application.SuccessDialog.show();

				if( !$scope.$$phase ){
					$scope.$digest();
				}
			}
			return; //All's OK
		}else if( inst.split('_')[0] === "ERR" ){
			var error = Commander.getError(data.getInstruction());
			$scope.$apply( function(){
				$scope.Error = error;
			} );
			Application.FailureDialog.show();
		}else if( inst === "ERROR" ){
			$scope.$apply( function(){
				$scope.Error = data.message;
			} );
			Application.FailureDialog.show();
		}else if( inst == "CONFIRM_OVERRIDE" ){
			$scope.Game.Prompt( data.message, "Prompt", function( ret_val ){
				$scope.Game.Create( ret_val, true );
			} );
		}
	};

	var socket_available = false;

	socket.onopen = function(){
		socket_available = true;
	}

	socket.onclose = function(){
		socket_available = false;
		console.log( "Socket closed." );
	}

	Commander = new WebsocketCommander( socket );
	$scope.Commander = Commander;

	$scope.Game = {
		GID: NaN,
		CID: NaN,
		Team1: new Team( query['Team1'] || 'Team1' ),
		Team2: new Team( query['Team2'] || 'Team2' ),

		GameClock: q('div#GameClock'),
		GameTime: new RoundTime( 15 ),

		QuestionClock: q('div#QuestionClock'),
		QuestionTime: new RoundTime( 0, 10 ),

		ToggleTimer: function(){
			var running = this.GameClock.getAttribute( 'data-enabled' )=="true"?"false":"true";
			this.GameClock.setAttribute( 'data-enabled', running );

			if( running == "true" ){
				this.StartTimer();
			}else{
				this.StopTimer();
			}
		},
		ToggleQuestionTimer: function(){
			var running = this.QuestionClock.getAttribute( 'data-enabled' )=="true"?"false":"true";
			this.QuestionClock.setAttribute( 'data-enabled', running );

			if( running == "true" ){
				this.StartQuestionTimer();
			}else{
				this.StopQuestionTimer();
			}
		},

		Notify: function( content ){
			Commander.Send( 'NOTIFY', {
				'email': $scope.Properties.Email,
				'content': content
			} );
		},

		Timer: null,
		StartTimer: function(){
			var self = this;

			if( self.GameTime.decis == 0  && self.GameTime.seconds == 0 && self.GameTime.minutes == 0 ) return;

			var start   = new Date().getTime();
			var time    = 0;

			this.Timer = setTimeout( function timer(){
				time += 100;

				if( ( self.GameTime.seconds == 59 && ( (self.GameTime.minutes == 19) || (self.GameTime.minutes == 14) ) ) ){
					self.Notify( 'Timer at ' + self.GameTime.toString() );
				}

				if( self.GameTime.minutes == 1 && self.GameTime.seconds == 0 && self.GameTime.decis == 0 ){
					Application.Warn( Audio.OneMinute );
				}

				if( self.GameTime.decis == 0){
					if( self.GameTime.seconds == 0 ){
						if( self.GameTime.minutes == 0 ){
							Application.Warn( Audio.MatchOver );
							if( $scope.Settings.DoResults )
								Application.Results.show();
							return;
						}else{
							self.GameTime.minutes--;
							self.GameTime.seconds = 59;
						}
					}else{
						self.GameTime.seconds--;
						self.GameTime.decis = 9;
					}
				}else{
					self.GameTime.decis--;
				}

				if( self.GameTime.minutes == 5 && self.GameTime.seconds == 0 && self.GameTime.decis == 0 ){
					Application.Warn( Audio.FiveMinutes );
				}
				//Need to $digest to update values in Angular
				$scope.$digest();

				var dtm = new Date().getTime();
				var diff = (dtm - start) - time;
				self.Timer = setTimeout( timer, (100 - diff) );
			}, 100);
		},
		StopTimer: function(){
			this.GameClock.setAttribute( 'data-enabled', 'false' );
			clearTimeout( this.Timer );
		},
		ResetTimer: function(){
			this.StopTimer();
			this.GameTime = new RoundTime( $scope.Settings.GameTime.getMinutes(), $scope.Settings.GameTime.getSeconds(), $scope.Settings.GameTime.getDecis() );
		},

		QTimer: null,
		StartQuestionTimer: function(){
			var self = this;

			if( self.QuestionTime.decis == 0  && self.QuestionTime.seconds == 0 && self.QuestionTime.minutes == 0 ) return;

			var start   = new Date().getTime();
			var time    = 0;

			if( this.QuestionClock.getAttribute('data-enabled') == "false" ) this.QuestionClock.setAttribute( 'data-enabled', "true" );

			this.QTimer = setTimeout( function timer(){
				time += 100;

				if( self.QuestionTime.decis == 0){
					if( self.QuestionTime.seconds == 0 ){
						if( self.QuestionTime.minutes == 0 ){
							self.ResetQuestionTimer();
							Application.Warn( Audio.Time );
							return;
						}else{
							self.QuestionTime.minutes--;
							self.QuestionTime.seconds = 59;
						}
					}else{
						self.QuestionTime.seconds--;
						self.QuestionTime.decis = 9;
					}
				}else{
					self.QuestionTime.decis--;
				}

				if( self.QuestionTime.seconds == 5 && self.QuestionTime.decis == 0 && Application.WarningBox.checked ){
					Application.Warn( Audio.FiveSeconds );
				}
				//Need to $scope.digest to update values in Angular
				if( !$scope.$$phase){
					$scope.$digest();
				}

				var dtm = new Date().getTime();
				var diff = (dtm - start) - time;
				self.QTimer = setTimeout( timer, (100 - diff) );
			}, 100);
		},
		StopQuestionTimer: function(){
			this.QuestionClock.setAttribute( 'data-enabled', 'false' );
			clearTimeout( this.QTimer );
		},
		ResetQuestionTimer: function(){
			this.StopQuestionTimer();
			this.QuestionTime = new RoundTime();
			$scope.$emit('question-timer-update');
		},
		SetQuestionTime: function( sec ){
			this.ResetQuestionTimer();
			this.QuestionTime = new RoundTime( 0, sec, 0 );
			this.StartQuestionTimer();
		},
		Reset: function(){
			this.ResetTimer();
			this.ResetQuestionTimer();
			this.Team1.setScore( 0 );
			this.Team2.setScore( 0 );
			this.Team1.setName('Team1');
			this.Team2.setName('Team2');

			if( !$scope.$$phase ){
				$scope.$digest();
			}
		},
		ResetConfirm: function(){
			if( confirm('Are you sure you want to reset?') ){
				this.Reset();
			}
		},

		Create: function( other_pwd, progress_override ){
			if( this.GameStarted ){
				Application.LoginDialog.close();
				this.Alert( "Game already Created!", "Error" );
				return;
			}

			Application.LoginDialog.close();
			Application.ProgressDialog.show();
			var meta = {};

			var form = Application.LoginForm;

			var pwd  = other_pwd || form.elements["comp_pwd"].value;
			input_pwd = pwd;
			var aid  = form.elements["comp_access_id"].value;
			if( pwd == "" || aid == "" ){
				Application.LoginDialog.close();
				Application.ProgressDialog.close();
				this.Alert( "One or more form fields were left empty.", "Error" );
				return;
			}

			meta['Team1_Name'] = $scope.Game.Team1.getName();
			meta['Team2_Name'] = $scope.Game.Team2.getName();

			if( !pwd ){
				return;
			}
			meta['password'] = pwd;
			meta['access_id'] = aid;
			meta['room'] = $scope.Properties.Room;

			Commander.Send( 'CREATE_GAME', meta );
		},

		Recover: function( other_pwd, progress_override ){
			if( this.GameStarted ){
				Application.RecoverDialog.close();
				this.Alert( "Game already Created!", "Error" );
				return;
			}

			Application.RecoverDialog.close();
			Application.ProgressDialog.show();
			var meta = {};

			var form = Application.RecoverForm;

			var pwd  = other_pwd || form.elements["comp_pwd"].value;
			input_pwd = pwd;
			var aid  = form.elements["comp_access_id"].value;
			var gid  = parseInt(form.elements["gid"].value) || '';
			if( pwd == "" || aid == "" ){
				Application.RecoverDialog.close();
				Application.ProgressDialog.close();
				this.Alert( "One or more form fields were left empty.", "Error" );
				return;
			}

			if( !pwd ){
				return;
			}
			meta['password'] = pwd;
			meta['access_id'] = aid;
			meta['gid']  = gid;

			Commander.Send( 'RECOVER_GAME', meta );
		},


		Destroy: function(){
			if( !this.GameStarted ){
				this.Alert( "Game not started yet!", "Error" );
				return;
			}

			this.Prompt( "Authentication required, enter competition password:", "Authentication", function(auth){  //Prompt will work on callback
				var meta = {
					gid: $scope.Game.GID,
					cid: $scope.Game.CID,
					pwd: auth
				};

				Commander.Send( 'FINALIZE', meta );
				$timeout( Application.ProgressDialog.show() );
			}, 'password' );
		},

		Alert: function( content, title ){
			title = title || 'Alert';

			$scope.Details.Alert.Title = title;
			$scope.Details.Alert.Message = content;

			$timeout( function(){ Application.AlertDialog.show() } );
		},

		Prompt: function( content, title, callback, type ){
			title = title || 'Prompt';

			type = type || 'text';
			Application.PromptForm.elements["prompt"].type = type;

			$scope.Details.Prompt.Title = title;
			$scope.Details.Prompt.Message = content;

			Application.PromptCallback = callback;
			$timeout( function(){ Application.PromptDialog.show() } );
		}

	};

	$scope.Details = {
		Alert: {
			Title: 'Alert',
			Message: ''
		},

		Prompt: {
			Title: 'Prompt',
			Message: ''
		}
	}

	$scope.UpdateTimer = function(){
		$scope.Game.GameTime = new RoundTime( $scope.Settings.GameTime.getMinutes(), $scope.Settings.GameTime.getSeconds(), $scope.Settings.GameTime.getDecis() );
		//Directly setting Game.GameTime equal to Settings.GameTime causes problems if the timer is running.
	}

	$scope.GetWinner = function( t1, t2 ){
		if( t1.getScore() > t2.getScore() ){
			return t1.getName();
		}else if( t2.getScore() > t1.getScore() ){
			return t2.getName();
		}else{
			return "Tie";
		}
	};

	window.onbeforeunload = function(){
		if( $scope.Game.GameStarted ){
			return "A game has been started, but the scores have not been finalized! Would you like to stay and finalize the scores before you leave?";
		}
	};

	(function loop(){
		if( !socket_available ){
			setTimeout( loop, 100 );
			return;
		}

		(function(){
			$scope.$watch( 'Game.Team1.getScore()', function( oldval, newval ){
				if( isNaN( $scope.Game.CID ) || isNaN( $scope.Game.GID ) ){
					return;
				}
				Commander.Send( 'SAVE_SCORE', {
					'T1S': $scope.Game.Team1.getScore(),
					'T2S': $scope.Game.Team2.getScore(),
					'T1N': $scope.Game.Team1.getName(),
					'T2N': $scope.Game.Team2.getName(),
					'gid': $scope.Game.GID,
					'comp': $scope.Game.CID,
					'comp_pwd': correct_pwd
				} );
			});
			$scope.$watch( 'Game.Team2.getScore()', function( oldval, newval ){
				if( isNaN( $scope.Game.CID ) || isNaN( $scope.Game.GID ) ){
					return;
				}
				Commander.Send( 'SAVE_SCORE', {
					'T1S': $scope.Game.Team1.getScore(),
					'T2S': $scope.Game.Team2.getScore(), 
					'T1N': $scope.Game.Team1.getName(),
					'T2N': $scope.Game.Team2.getName(),
					'gid': $scope.Game.GID,
					'comp': $scope.Game.CID,
					'comp_pwd': correct_pwd
				} );
			});

			$scope.$on( '$locationChangeStart', function(){
				Commander.Send( "FINALIZE", {
					'pwd': correct_pwd,
					'cid': $scope.Game.CID,
					'gid': $scope.Game.GID
				} );
			} );
		})();
	})();
}
