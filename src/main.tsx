import { ContextAPIClients, UIClient, UseIntervalResult, UseStateResult, Devvit, RedisClient, TriggerContext, useWebView, SettingScope, useForm } from '@devvit/public-api';
import { usePagination } from '@devvit/kit';
Devvit.configure({redditAPI: true, 
                  redis: true,
                  userActions: false });

const resolutionx = 22;
const resolutiony = 34;
const sizex = 23.445;
const sizey = 20.45;
const sizexBlocks = 15.59;
const sizeyBlocks = 16;
const redisExpireTimeSeconds = 3888000;//45 days in seconds.
const maxWrongAttempts = 30;
let dateNow = new Date();
const redisExpireTimeMilliseconds = redisExpireTimeSeconds * 1000;
const expireTime = new Date(dateNow.getTime() + redisExpireTimeMilliseconds);
const leaderBoardPageSize = 13;

type leaderBoard = {
  username: string;
  timeInSeconds: number;
  attempts: number;
  foundSpots: number[];
};

type displayBlocks = {
  help: boolean,
  picture: boolean,
  spots: boolean,
  spotTiles: boolean,
  zoomView: boolean,
  zoomAlignment: Devvit.Blocks.Alignment,
  zoomSelect:boolean,
  confirmShowSpot:boolean,
  leaderBoard: boolean,
  MarkSpotsInfo: boolean,
  Info: boolean,
};

enum gameStates {
  NotStarted,
  Started,
  Finished,
  Aborted, 
  Paused
}

export enum Pages {
  Picture,
  Help,
  MarkSpotsInfo,
  LeaderBoard,
  ZoomView
}

type UserGameState = {
  state: gameStates;
  startTime: number;
  counter: number;
  attemptsCount: number;
  foundSpots: number[];
}

type webviewSpotDataRequest = {
  type: string;
  row: number;
  col: number;
};

type postArchive = {
  image: string,
  tilesData: string,
  leaderboard: leaderBoard[]
}

class SpottitGame {
  private _counterInterval: UseIntervalResult;
  private readonly _ui: UIClient;
  private _currPage: UseStateResult<Pages>;
  private redis: RedisClient;
  private _ScreenIsWide: boolean;
  private _context: ContextAPIClients;
  private _UIdisplayBlocks: UseStateResult<displayBlocks>;
  private _myPostId: UseStateResult<string>;
  private _currentUsername: UseStateResult<string>;
  private _authorName: UseStateResult<string>;
  private _userGameStatus: UseStateResult<UserGameState>;
  private _validTileSpotsMarkingDone: UseStateResult<boolean>;
  private _leaderBoardRec:UseStateResult<leaderBoard[]>;
  private _imageURL:UseStateResult<string>;
  private _tilesData: UseStateResult<number[]>;
  private _tilesData2D: UseStateResult<number[][]>;
  private _userIsAuthor: boolean;
  private _redisKeyPrefix: string;
  private _isGameArchived: UseStateResult<boolean>;
  private _spotsCount: UseStateResult<number>;
  private _isUserSubscribed:UseStateResult<boolean>;
  private _userSelectedForDeletion:UseStateResult<string>;
  private _userIsModerator:UseStateResult<boolean>;

  private confirmDeleteLeaderboardRecForm = useForm(
    (data) => ({
      title: 'Confirm Action',
      description: `Are you sure you want to delete ${data.userSelectedForDeletion} from Leaderboard?`,
      fields: [
      ],
      acceptLabel: 'Yes',
      cancelLabel: 'No',
    }),
    (values) => {
      this.deleteSlectedUserFromLeaderboard();
    }
  );

  constructor( context: ContextAPIClients, postId: string) {
    this._userSelectedForDeletion = context.useState(async () => {
      return '';
    });;
    this._context = context;
    this._ui = context.ui;
    this.redis = context.redis;
    this._ScreenIsWide = this.isScreenWide();

    this._counterInterval = context.useInterval( async () => {

      if( this.userGameStatus.state == gameStates.Started && this.userGameStatus.attemptsCount < maxWrongAttempts) {
        var timeNow = new Date().getTime();
        const ugs = this.userGameStatus;

        if( timeNow > ugs.startTime ) {
          ugs.counter = Math.floor ( (timeNow - ugs.startTime ) / 1000 );
          if( ugs.counter > 1800 ) {//Max out the counter at 30 minutes.
            ugs.counter = 1800
          }
        }
        else {//default to 1 in case somehow timeNow is not greater than startTime.
          ugs.counter = 1;
        }
        this.userGameStatus = ugs;
      }
    }, 1000);

    this._myPostId = context.useState(async () => {
      return postId;
    });

    this._currentUsername = context.useState(async () => {
      const currentUserName = await context.reddit.getCurrentUsername() ??'defaultUsername';
      return currentUserName;
    });

    this._isUserSubscribed = context.useState(async () => {
      var subscribedStatus = await this.redis.get(this._currentUsername+'IsSubscribed');
      if( subscribedStatus && subscribedStatus == "true" ) {
        return true;
      }
      return false;
    });

    this._redisKeyPrefix = this.myPostId + this.currentUsername;

    this._authorName = context.useState(async () => {
      const authorName = await this.redis.get(this.myPostId+'authorName');
      if (authorName) {
          return authorName;
      }
      return "";
    });

    this._userIsAuthor = this.currentUsername == this.authorName;

    this._userIsModerator = context.useState(async () => {
      const subreddit = await this._context.reddit.getCurrentSubreddit();
      const moderators = await subreddit.getModerators().all();

      for (const mod of  moderators) {
        if (mod.username === this.currentUsername) {
          return true;
        }
      }
      return false;
    });;

    this._userGameStatus = context.useState<UserGameState>(
      async() =>{
        const UGS:UserGameState = {state: gameStates.NotStarted, startTime: 0, counter: 0, attemptsCount: 0, foundSpots: [] };
        const redisValues = await this.redis.mGet([ this.redisKeyPrefix+'GameAborted', 
                                                    this.redisKeyPrefix+'StartTime', 
                                                    this.redisKeyPrefix+'AttemptsCount', 
                                                    this.redisKeyPrefix+'FoundSpots']);

        if(redisValues && redisValues.length >= 3)
        {
          if (redisValues[0] && redisValues[0] == 'true' ) {
            UGS.state = gameStates.Aborted;
          }

          if (redisValues[1] && redisValues[1].length > 0  && UGS.state != gameStates.Aborted ) {
            UGS.startTime = parseInt(redisValues[1]);
            UGS.state = gameStates.Paused;
          }

          if (redisValues[2] && redisValues[2].length > 0 ) {
            var attemptsCountIntValue = parseInt(redisValues[2]);
            UGS.attemptsCount = attemptsCountIntValue;
            if( UGS.attemptsCount >= maxWrongAttempts ) {
              UGS.state = gameStates.Aborted;
            }
          }

          if ( redisValues.length > 3 && redisValues[3] && redisValues[3].length > 0 ) {
            var foundSpots = redisValues[3];
            UGS.foundSpots = foundSpots.split(",").map(Number);
          }
          else {
            UGS.foundSpots = [];
          }
        }
        return UGS;
      }
    );

    this._validTileSpotsMarkingDone = context.useState(async () => {
      const ValidTileSpotsMarkingDone = await context.redis.get(this.myPostId+'ValidTileSpotsMarkingDone');
      if( ValidTileSpotsMarkingDone) {
        if(  ValidTileSpotsMarkingDone == 'true' ) {
          return true;
        } 
        else {
          return false;
        }
      }
  
      if( this.userIsAuthor ) {
        this.currPage = Pages.MarkSpotsInfo;
      }
      
      return true;
    });

    this._currPage = context.useState(async () => {
      return Pages.Picture;
    });

    this._UIdisplayBlocks = context.useState<displayBlocks>(() => {
      const dBlocks:displayBlocks = {help:false, 
        picture: this.userIsAuthor && !this.validTileSpotsMarkingDone && !this._ScreenIsWide ? false:  true,
        spotTiles: this.userIsAuthor || this.userGameStatus.state == gameStates.Started || this.userGameStatus.state == gameStates.Aborted,
        spots: !this.validTileSpotsMarkingDone,
        zoomView: false,
        zoomAlignment: "top start",
        zoomSelect:false,
        confirmShowSpot:false,
        leaderBoard: false,
        MarkSpotsInfo: !this.validTileSpotsMarkingDone && this.userIsAuthor,
        Info: false};
      return dBlocks;
    });

    this._imageURL = context.useState(async () => {
      const imageURL = await context.redis.get(this.myPostId+'imageURL');
      if (imageURL) {
        return imageURL;
      }
      return "";
    });

    this._tilesData = context.useState(
      async () => {
        const tilesDataStr = await context.redis.get(this.myPostId+'TilesDataArray');
        if (tilesDataStr && tilesDataStr.length > 0 ) {
          return tilesDataStr.split(",").map(Number);
        }
        else {//Retrieve tiles data from archive comment.
          const redditPostComments = await getRedditPostComments(context, postId);
          for( var i=0; i<redditPostComments.length; i++ ) {
            if( redditPostComments[i].authorName == 'spottit-game' && redditPostComments[i].body.includes("\"tilesData\"") ) {
              try {
                var pa = JSON.parse(redditPostComments[i].body);

                if( pa.hasOwnProperty("leaderboard") && ! pa.leaderboard[0].hasOwnProperty("foundSpots") ) {
                  for( i=0; i< pa.leaderboard.length; i++ ) {
                    pa.leaderboard.foundSpots = [1];//Default to 1 spot found when the attribute is missing.
                  }
                }
                const postArchive = pa as postArchive;
                console.log("Retrieved tiles-data from comment json");
                this.imageURL = postArchive.image;
                return postArchive.tilesData.split(",").map(Number);
              } catch (e) {
                console.log(e);
                continue;//Skip current entry and try next.
              }
            }
          }
        }
        return new Array(resolutionx * resolutiony).fill(0);
      }
    );

    this._tilesData2D = context.useState(
       () => {
        var array2d = new Array(resolutiony).fill(0).map(() => new Array(resolutionx).fill(0));
        for(var row=0; row<resolutiony; row++ ) {
          for( var col=0; col< resolutionx; col++) {
            array2d[row][col] = this._tilesData[0][ (row * resolutionx )  + col];
          }
        }
        
        return array2d;
      }

    );

    this._spotsCount = context.useState(
      () => {
        var sc = new Set(this._tilesData[0]).size - 1;
        return sc;
     }
    );

    this._leaderBoardRec = context.useState(async () => {//Get Leaderboard records.
      var records = await getLeaderboardRecords(context, this.myPostId);
      for(var i =0; i < records.length; i++ ) {
        if(records[i].username == this.currentUsername) {
          const usg = this._userGameStatus[0];
          usg.state = records[i].foundSpots.length == this.spotsCount ? gameStates.Finished : gameStates.Paused;
          usg.counter = records[i].timeInSeconds;
          usg.attemptsCount = records[i].attempts;
          usg.foundSpots = records[i].foundSpots;
          this.userGameStatus = usg;
        }
      }
      return records;
    });

    this._isGameArchived = context.useState(async () => {
      return await this.isGameArchived();
    });

  }

  get userIsAuthor() {
    return this._userIsAuthor;
  }
  
  get redisKeyPrefix() {
    return this._redisKeyPrefix;
  }

  get currPage() {
    return this._currPage[0];
  }

  get authorName() {
    return this._authorName[0];
  }

  get userIsModerator() {
    return this._userIsModerator[0];
  }

  get imageURL() {
    return this._imageURL[0];
  }

  get gameArchived() {
    return this._isGameArchived[0];
  }

  get userSelectedForDeletion() {
    return this._userSelectedForDeletion[0];
  }

  set userSelectedForDeletion(value) {
    this._userSelectedForDeletion[0] = value;
    this._userSelectedForDeletion[1](value);
  }

  public set UIdisplayBlocks(value: displayBlocks) {
    this._UIdisplayBlocks[0] = value;
    this._UIdisplayBlocks[1](value);
  }

  public set spotsCount(value:number) {
    this._spotsCount[0] = value;
    this._spotsCount[1](value);
  }

  public set validTileSpotsMarkingDone(value: boolean) {
    this._validTileSpotsMarkingDone[0] = value;
    this._validTileSpotsMarkingDone[1](value);
  }

  public set isUserSubscribed(value: boolean) {
    this._isUserSubscribed[0] = value;
    this._isUserSubscribed[1](value);
  }

  public set userGameStatus(value: UserGameState) {
    this._userGameStatus[0] = value;
    this._userGameStatus[1](value);
  }

  public set currPage(value: Pages) {
    this._currPage[0] = value;
    this._currPage[1](value);
  }

  public set leaderBoardRec(value: leaderBoard[]) {
    this._leaderBoardRec[0] = value;
    this._leaderBoardRec[1](value);
  }

  private set tilesData(value: number[]) {
    this._tilesData[0] = value;
    this._tilesData[1](value);
  }

  private set tilesData2D(value: number[][]) {
    this._tilesData2D[0] = value;
    this._tilesData2D[1](value);
  }

  private set imageURL(value: string) {
    this._imageURL[0] = value;
    this._imageURL[1](value);
  }

  public set counterInterval(value: UseIntervalResult ) {
    this._counterInterval = value;
  }
  
  public get UIdisplayBlocks() {
    return this._UIdisplayBlocks[0];
  }

  public get leaderBoardRec() {
    return this._leaderBoardRec[0];
  }

  public get userGameStatus() {
    return this._userGameStatus[0];
  }

  public get tilesData() {
    return this._tilesData[0];
  }

  public get tilesData2D() {
    return this._tilesData2D[0];
  }

  public get validTileSpotsMarkingDone() {
    return this._validTileSpotsMarkingDone[0];
  }
  
  public get myPostId() {
    return this._myPostId[0];
  }

  public get spotsCount() {
    return this._spotsCount[0];
  }

  public get currentUsername() {
    return this._currentUsername[0];
  }

  public get isUserSubscribed() {
    return this._isUserSubscribed[0];
  }

  private isScreenWide() {
    const width = this._context.dimensions?.width ?? null;
    return width == null ||  width < 688 ? false : true;
  }

  private async deleteSlectedUserFromLeaderboard() {
    const leaderBoardArray = this.leaderBoardRec;
    var updatedLeaderBoardArray = this.leaderBoardRec;
    for(var i=0; i< leaderBoardArray.length; i++ ) {
      if( leaderBoardArray[i].username == this.userSelectedForDeletion) {
        updatedLeaderBoardArray.splice(i, i+1);
      }
    }
    this.leaderBoardRec = updatedLeaderBoardArray;
    var removedItemsCount = await this.redis.hDel(this.myPostId, [this.userSelectedForDeletion]);
    await this.redis.del( this.myPostId + this.userSelectedForDeletion +'GameAborted');
    await this.redis.del( this.myPostId + this.userSelectedForDeletion +'StartTime');
    await this.redis.del( this.myPostId + this.userSelectedForDeletion +'AttemptsCount'); 
    await this.redis.del( this.myPostId + this.userSelectedForDeletion +'FoundSpots');
    this._context.ui.showToast(this.userSelectedForDeletion+" has been deleted from the Leaderboard");
  }

  private async isGameArchived() {
    var expireTimestamp = await getPostExpireTimestamp(this._context, this.myPostId);
    var dateNow = new Date();
    var nowTimestamp = dateNow.getTime();
    if( nowTimestamp > expireTimestamp ) {
      return true;
    }
    else {
      return false;
    }
  }

  public async toggleValidTile( index=0 ) {
    var d = this.tilesData;
    const row = Math.floor( index / resolutionx );
    const col = index - (row * resolutionx);
    var d2d = this.tilesData2D;
    if( d[index] != 0 ) {
      d[index] = 0;
      d2d[row][col] = 0;
    }
    else {
      d[index] = 1;
      d2d[row][col] = 1;
    }
    this.tilesData2D = d2d;
    this.tilesData = d;
  }

  public async finishMarkingSpots() {
      if( this.tilesData.find((element) => element == 1) ) {//There is at-least one spot selected.
      var targetNumber = 2;
      var searchNumber = 1;
      for( var i=0; i< this.tilesData2D.length; i++ ) {
          for( var j = 0; j< this.tilesData2D[i].length; j ++ ) {
            if( this.tilesData2D[i][j] == 1 ) {
              floodFillRecursive(this.tilesData2D, i, j, targetNumber, searchNumber);
              targetNumber ++;
            }   
          }
      }
      this.tilesData = this.tilesData2D.flat();
      const dBlocks:displayBlocks = this.UIdisplayBlocks;
      this.validTileSpotsMarkingDone = true;
      await this.redis.set(this.myPostId+'ValidTileSpotsMarkingDone', 'true', {expiration: expireTime});
      const redisDataStr = this.tilesData.join(","); 
      await this.redis.set(this.myPostId+'TilesDataArray', redisDataStr, {expiration: expireTime});
      dBlocks.spots = false;
      this.UIdisplayBlocks = dBlocks;

      this._context.ui.showToast({
        text: "Your post is now ready for others to play! ✅",
        appearance: 'success',
      });

    }
    else {
      this._context.ui.showToast({
        text: "There are no tiles selected. Please select the tiles to mark spot that participants must find.",
        appearance: 'neutral',
      });
    }
  }

  public getLeaderBoardPercentile(seconds:number) {//Return the perentiile among the leaderboard entries
    var lbRecs = this.leaderBoardRec;
    var count = 1;

    for(var i=0;i< lbRecs.length; i++) {
      if(lbRecs[i].timeInSeconds < seconds )
        count++;
      else
        break;
    }
    var percentile = (count / lbRecs.length) * 100;
    return percentile;
  }

  public async showTheSpotAndAbort() {
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    await this.redis.set(this.redisKeyPrefix+'GameAborted', 'true', {expiration: expireTime});
    const ugs = this.userGameStatus;
    ugs.state = gameStates.Aborted;
    this.userGameStatus = ugs;
    dBlocks.spots = true;
    dBlocks.confirmShowSpot = false;
    this._context.ui.showToast({
      text: "You can find the object/thing behind the red spots shown!",
      appearance: 'neutral',
    });
    this.UIdisplayBlocks = dBlocks;
  }

  public async deleteLeaderboardRec(username: string) {//TODO: Add confirmation dialog
    this.userSelectedForDeletion = username;
    this._context.ui.showForm(this.confirmDeleteLeaderboardRecForm, {userSelectedForDeletion: username});
  }

  public async alertRepeatSpotting() {
    this._context.ui.showToast({
      text: "You have already found this spot, you need to find "+(this.spotsCount - this.userGameStatus.foundSpots.length)+" other spot(s).",
      appearance: 'neutral',
    });
  }
  
  public async addFoundSpot(spotNumber:number) {//Returns true if game is finished, false otherwise.
    var ugs = this.userGameStatus;
    var isGameFinished = false;

    if( ! ugs.foundSpots.includes(spotNumber) ) {
      ugs.foundSpots.push(spotNumber);
      this.userGameStatus = ugs;
    }

    if( ugs.foundSpots.length >= this.spotsCount ) {
      this.finishGame();
      isGameFinished = true;
    }
    else {
      this._context.ui.showToast({
        text: "✅ You have found "+ugs.foundSpots.length+" out of "+this.spotsCount+" spots. Time: "+this.userGameStatus.counter+" seconds",
        appearance: 'success',
      });
    }

    if( !this.gameArchived ) {
      await this.updateLeaderboard();
    }
    await this.redis.set(this.redisKeyPrefix+'FoundSpots', this.userGameStatus.foundSpots.join(",") , {expiration: expireTime});
    return isGameFinished;
  }

  public async updateLeaderboard() {
    const ugs = this.userGameStatus;
    var foundEntry = false;

    if( ugs.foundSpots.length == this.spotsCount ) {
      ugs.state = gameStates.Finished;
    }
    const leaderBoardArray = this.leaderBoardRec;

    if( ugs.counter <= 0 ) {
      ugs.counter = 1;
    }

    for(var i =0; i < leaderBoardArray.length; i++ ) { //Search and update existing leaderboard entry if found.
      if(leaderBoardArray[i].username == this.currentUsername) {
        foundEntry = true;
        leaderBoardArray[i].foundSpots = ugs.foundSpots;
        leaderBoardArray[i].timeInSeconds =  ugs.counter;
      }
    }

    const leaderBoardObj:leaderBoard  = { username:this.currentUsername, 
      timeInSeconds: this.userGameStatus.counter, 
      attempts: this.userGameStatus.attemptsCount,
      foundSpots: this.userGameStatus.foundSpots
    };

    if( !foundEntry ) { //Create fresh entry in leaderboard:
      leaderBoardArray.push(leaderBoardObj);
    }

    await this.redis.hSet(this.myPostId, { [this.currentUsername]: JSON.stringify(leaderBoardObj) });
    await this.redis.expire(this.myPostId, redisExpireTimeSeconds);

    leaderBoardArray.sort((a, b) =>  b.foundSpots.length - a.foundSpots.length || a.timeInSeconds - b.timeInSeconds);
    this.leaderBoardRec = leaderBoardArray;

    this.userGameStatus = ugs;
    await this.createPostArchiveCommentJob();//Add/update archive comment.
  }

  public async finishGame() {

    var percentileMessage = '';
    var percentile = this.getLeaderBoardPercentile(this.userGameStatus.counter);
    if(percentile < 100 ) {
      percentileMessage = "You are top "+ percentile.toFixed() +"% among the finishers."
    }

    this._context.ui.showToast({
      text: "Congrats! 🎊 You finished in "+this.userGameStatus.counter+" seconds! "+percentileMessage,
      appearance: 'success',
    });

    const commentAddOnBehalf = await this._context.settings.get('commentAddOnBehalf');
    const commentMinimumTimeInSeconds:number = await this._context.settings.get('commentMinimumTimeInSeconds')?? 60;

    if( commentAddOnBehalf && this.userGameStatus.counter < commentMinimumTimeInSeconds ) {
      //Disabling comment on behalf for this version. Planning to release it on next release.
      /*
      const redditComment = await this._context.reddit.submitComment({
        id: `${this.myPostId}`,
        text: "I found the spot(s) in "+this.userGameStatus.counter+" seconds! Try beating that in this [Spottit game](https://reddit.com/r/Spottit)."
      });
      */
    }

    const dBlocks:displayBlocks = this.UIdisplayBlocks; //switch to old picture view after game is finished.
    dBlocks.zoomView = false;
    dBlocks.picture = true;
    this.UIdisplayBlocks = dBlocks;
    this.setHomepage();
  }

  public async incrementAttempts() {
    const ugs = this.userGameStatus;
    this._context.ui.showToast({
      text: "Sorry, that is not the right spot!",
      appearance: 'neutral',
    });        
    ugs.attemptsCount = ugs.attemptsCount + 1;
    await this.redis.set(this.redisKeyPrefix+'AttemptsCount', ugs.attemptsCount.toString(), {expiration: expireTime});

    if (ugs.attemptsCount >= maxWrongAttempts ) {
      await this.redis.set(this.redisKeyPrefix+'GameAborted', 'true', {expiration: expireTime});
      ugs.state = gameStates.Aborted;
    }

    this.userGameStatus = ugs;
  }

  public async checkIfTileIsValid(index:number) {
    if( this._tilesData[0][index] ==  1 && this.userGameStatus.counter > 0 ) {
      await this.finishGame();
    }
    else {
      await this.incrementAttempts();
    }
  }

  public async openIntroPage() {
    this._context.ui.navigateTo('https://www.reddit.com/r/Spottit/comments/1ethp30/introduction_to_spottit_game/');
  };

  public async openSourceImage() {
    this._context.ui.navigateTo(this.imageURL);
  };

  public toggleSpots() {
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    dBlocks.spotTiles = true;
    if( dBlocks.spots ) {
      dBlocks.spots = false;
    }
    else {
      dBlocks.spots = true;
    }
    this.UIdisplayBlocks = dBlocks;
  }

  public setHomepage() {
    if( this.validTileSpotsMarkingDone ) {
      this.currPage = Pages.Picture;
    }
  }

  public showHelpBlock() {
    this.currPage = Pages.Help;
  }

  public async subscribeUserToSub() {
    await this._context.reddit.subscribeToCurrentSubreddit();
    await this.redis.set(this._currentUsername+'IsSubscribed', "true", {expiration: expireTime});
    this.isUserSubscribed = true;
    this._context.ui.showToast('Subscribed! ✅')
  }
  
  public showLeaderboardBlock() {
    this.currPage = Pages.LeaderBoard;
  }

  public hideLeaderboardBlock() {
    this.setHomepage();
  }

  public hideHelpBlock() {
    this.setHomepage();
  }

  public pauseGame() {
    this._counterInterval.stop();
    const ugs = this.userGameStatus;
    ugs.state = gameStates.Paused;
    this.userGameStatus = ugs;
  }

  public async startOrResumeGame() {
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    const ugs = this.userGameStatus;
    ugs.state = gameStates.Started;
    var timeNow = new Date().getTime();
    if( ugs.startTime == 0 ) { //First time the game is starting, set start time. 
      ugs.startTime = new Date().getTime();
      await this.redis.set(this.redisKeyPrefix+'StartTime', ugs.startTime.toString(), {expiration: expireTime});
    }
    ugs.counter = Math.floor ( (timeNow - ugs.startTime ) / 1000 );
    this.userGameStatus = ugs;

    this._counterInterval.start();
    await this.redis.set(this.redisKeyPrefix+'GameAborted', 'false', {expiration: expireTime});

    this.currPage = Pages.ZoomView;
    dBlocks.zoomView = true;
    this.UIdisplayBlocks = dBlocks;

    this._context.ui.showToast({text: `Double-tap/click on the spot when you find!`,
      appearance: 'neutral'});
  }

  public async createPostArchiveCommentJob() {
    try {
      var dateNow = new Date();
      var postArchiveRuneAt = new Date(dateNow.getTime() + 2000);//Schedule it 2 seconds after now.
      const jobId = await this._context.scheduler.runJob({
        runAt: postArchiveRuneAt,
        name: 'post_archive_comment_job',
        data: { 
          postId: this.myPostId,
        }
      });
    } catch (e) {
      console.log('error - was not able to create post_archive_comment_job:', e);
      throw e;
    }
  }
}

Devvit.addSettings([
  {
    type: 'boolean',
    name: 'commentAddOnBehalf',
    label: 'Add comment to post on behalf of the participant on completion of the game',
    scope: SettingScope.Installation, 
    defaultValue: false
  },
  {
    type: 'number',
    name: 'commentMinimumTimeInSeconds',
    label: 'Minimum time in seconds to include in a comment(on behalf of participant)',
    scope: SettingScope.Installation,
    defaultValue: 60
  },
]);

Devvit.addTrigger({
  event: 'PostDelete',
  onEvent: async (event, context) => {//Delete all keys associated with post.
    const {redis} = context;
    console.log(`Received PostDelete event:\n${JSON.stringify(event)}`);
    await redis.del(event.postId);
    await redis.del(event.postId+'imageURL');
    await redis.del(event.postId+'authorName');
    await redis.del(event.postId+'ValidTileSpotsMarkingDone');
    await redis.del(event.postId+'TilesDataArray');
  },
});

Devvit.addSchedulerJob({
  name: 'post_archive_comment_job',  
  onRun: async(event, context) => {
    const myPostId = event.data!.postId as string;
    const tilesDataStr = await context.redis.get(myPostId+'TilesDataArray');
    const imageUrl = await context.redis.get(myPostId+'imageURL');

    if ( (tilesDataStr && tilesDataStr.length > 0 ) && (imageUrl && imageUrl.length > 0 ) ) {
      var leaderboard = await getLeaderboardRecords(context, myPostId);
      //Archive only first 80 records in leaderboard as there limitation on the reddit comment size.
      leaderboard = leaderboard.slice(0, 80);
      var pa: postArchive = {image: imageUrl , tilesData: tilesDataStr, leaderboard: leaderboard};
      var archiveCommentJson = JSON.stringify(pa);
      const archiveCommentId = await context.redis.get(myPostId+'archiveCommentId');

      if (archiveCommentId && archiveCommentId.length > 0 ) {//Update existing archive comment.
        const comment = await context.reddit.getCommentById(archiveCommentId);
        if( comment) {
          await comment.edit({ text: archiveCommentJson });
        }
      }
      else {//Create new archive comment.
        const redditComment = await context.reddit.submitComment({
          id: `${myPostId}`,
          text: archiveCommentJson
        });
        await context.redis.set(myPostId+'archiveCommentId', redditComment.id, {expiration: expireTime} );
      }
    }
  },
});

Devvit.addCustomPostType({
  name: 'Spottit Post',
  height: 'tall',
  render: context => {
    const { mount, unmount, postMessage } = useWebView({
      url: 'zoom-view.html',
      onMessage: async (message, webView) => {
        const wr = message as webviewSpotDataRequest;
        const tilesData = {
        data: game.tilesData,
        resolutionx : resolutionx,
        resolutiony : resolutiony,
        sizex: sizex,
        sizey:sizey
        };

        if( wr.type == "requestImage") {//Load image
          postMessage({data: {type: "image", 
                            url: game.imageURL, 
                            tilesData: tilesData, 
                            ugs: game.userGameStatus, 
                            userIsAuthor: game.userIsAuthor, 
                            validTileSpotsMarkingDone: game.validTileSpotsMarkingDone,
                            playersCount: game.leaderBoardRec.length,
                            spotsCount: game.spotsCount,
          }});
        }
        else if(wr.type == "succcessfulSpotting") {//Finish the game with usual process.
          const isGameFinished = await game.addFoundSpot( game.tilesData2D[wr.row][wr.col]);
          if( isGameFinished ) {
            webView.unmount();
          }
        }
        else if(wr.type == "unsucccessfulSpotting") {
          await game.incrementAttempts();
        }
        else if(wr.type == "startOrResumeGame") {
          await game.startOrResumeGame();
        }
        else if(wr.type == "repeatSucccessfulSpotting") {//Finish the game with usual process.
          await game.alertRepeatSpotting();
        }
      },
      onUnmount: async () => {
        if( game.userGameStatus.state !== gameStates.Finished && game.userGameStatus.state !== gameStates.Aborted ) {
          game.pauseGame();
        }
        game.setHomepage();
      }
    });

    let cp: JSX.Element[];
 
    const openUserPage = async (username: string) => {
      context.ui.navigateTo(`https://www.reddit.com/user/${username}/`);
    };

    const PictureTilesWidth = `${resolutionx * sizexBlocks}px`;
    const PictureTilesHeight = `${resolutiony * sizeyBlocks}px`;

    function splitArray<T>(array: T[], segmentLength: number): T[][] {
      const result: T[][] = [];
      for (let i = 0; i < array.length; i += segmentLength) {
        result.push(array.slice(i, i + segmentLength));
      }
      return result;
    }
    
    const LeaderBoardBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="96%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small"  width="100%">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="100%"  color='black'>
                Leaderboard
            </text>
          </hstack>
          <hstack padding="small" width="100%" backgroundColor="#c0c0c0" height="8%" alignment='center'>
            <text style="heading" size="small" color="black" width="10%" alignment="center">
              Rank
            </text>
            <text style="heading" size="small" color="black" width="40%" alignment="center">
              Username
            </text>
            <text style="heading" size="small" color="black" width="15%" alignment="center">
              Spots
            </text>
            <text style="heading" size="small" color="black" width="25%" alignment="center">
              Time
            </text>
          </hstack>
          <vstack width="100%" padding="small" height="70%">
            {
            currentItems.map((row, index) => (
            <LeaderBoardRow row={row} index={index + 1 + (currentPage * leaderBoardPageSize )} game={game} />
            ))}
            {game.leaderBoardRec.length == 0 ?<text style="body" size="small" color="black" width="100%" alignment="middle" wrap>
              The leaderboard is empty. You could be the first, close this and start the game!
            </text>:""}
          </vstack>
          <hstack alignment="middle center" width="100%" height="10%">
            <button size="small" onPress={toPrevPage} icon="left"/>
            <spacer size="xsmall" /><text alignment="middle" color="black"> Page: {currentPage + 1}</text><spacer size="xsmall" />
            <button size="small" onPress={toNextPage} icon="right"/>
            <spacer size="small" />
            <button size="small" icon='close' onPress={() => game.hideLeaderboardBlock()}>Close</button>
          </hstack>
          <spacer size="small" />
        </vstack>
      </vstack>
    );

    const LeaderBoardRow = ({row, index, game}: {row: leaderBoard, index: number,  game: SpottitGame }): JSX.Element => {
      return (<hstack padding="xsmall" alignment="middle center">
        <text style="body" size="small" weight="bold" color="black" width="10%" alignment="center">
          {index}
        </text>
        <text style="body" size="small" weight="bold" color="black" onPress={() => openUserPage(row.username)} width="40%" alignment="center">
          {row.username}
        </text>
        <text style="body" size="small" color="black" alignment="center" width="15%">
          {row.foundSpots.length}
        </text>
        <text style="body" size="small" color="black" width="25%" alignment="center">
          &nbsp;{row.timeInSeconds}
        </text>
        { game.userIsAuthor  || game.userIsModerator ? <text size="small" color="black" onPress={() => game.deleteLeaderboardRec(row.username)} width="5%">X</text>: ""}
        </hstack>
      );
    };

    const InfoBlock = ({ game }: { game: SpottitGame }) => (     
    <vstack width="344px" height={'100%'} alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.60)'>
      <hstack>
        <vstack width="300px" alignment='center middle'>
          <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center'>
             {game.leaderBoardRec.length} players have taken part in this Spottit post.
          </text>
          <spacer size="medium"/>
          <button icon="image-post" appearance="media" onPress={mount} >View image!</button>
        </vstack>
      </hstack>
    </vstack>
    );

    const ConfirmShowSpotBlock = ({ game }: { game: SpottitGame }) => (
      <hstack width="344px" height="100%" alignment="middle center" backgroundColor='transparent'>
        <vstack  width="320px" height="45%" alignment="center middle" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="270px" color='black'>
                &nbsp;Are you sure to give up?
            </text>
            <button size="small" icon='close' width="34px" onPress={() => {
                const dBlocks:displayBlocks = game.UIdisplayBlocks;
                dBlocks.confirmShowSpot = false;
                game.UIdisplayBlocks = dBlocks;
              }}></button>
          </hstack>
          <vstack height="70%" width="100%" padding="medium">
            <text wrap color='black'>
            Are you sure you want give up and view the spot? You will not be able to resume again.
            </text>
            <spacer size="large" />
            <hstack alignment="bottom center" width="100%">
              <button size="small" icon='checkmark' onPress={() => game.showTheSpotAndAbort()}>Yes</button>
              <spacer size="medium" />
              <button size="small" icon='close' onPress={() => {
                game.setHomepage();
                const dBlocks:displayBlocks = game.UIdisplayBlocks;
                dBlocks.confirmShowSpot = false;
                game.UIdisplayBlocks = dBlocks;
              }}>Cancel</button>
            </hstack>
          </vstack>
        </vstack>
      </hstack>
    );

    const MarkSpotsInfo = ({ game }: { game: SpottitGame }) => (     
      <vstack width="344px" height={'100%'} alignment="start middle" backgroundColor='white' padding="medium">
        <hstack>
          <vstack width="300px" backgroundColor='white' alignment="center middle">
            <text width="300px" size="large" weight="bold" wrap color="black">
              Mark all the tiles/spots that includes what the participants must find.
            </text>
            <spacer size="large"></spacer>
            <text width="300px" size="small" style='body' weight="regular" wrap color="black">
              Please mark tiles by clicking on the respective boxes. If the object corners run into other boxes, include those boxes too.
              Use browser zoom features to zoom in and out while marking.
              Wait for the box to fill with red colour after tapping. To undo marking, click on the marked tile again.
            </text>
            <spacer size="small"></spacer>
            <text width="300px" size="small" style='body' weight="regular" wrap color="black">
            After marking all the tiles, Click on 'Done marking!'.
            </text>
            <spacer size="large"></spacer>

            <button size="small" icon='joined' onPress={() => {
                                game.currPage = Pages.Picture;
              }}>Start marking!</button>
          </vstack>
        </hstack>
      </vstack>
      );

    const GameStartBlock = ({ game }: { game: SpottitGame }) => (
    <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.60)'>

        {game.userGameStatus.state == gameStates.NotStarted ? <>
          <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Click 'Start!' when you're ready!</text>
          <spacer size="small"/>
          <button appearance="success" onPress={mount}>Start!</button>
        </>:""}

      <spacer size="small"/>
      <hstack>
        <spacer size="small"/>
        { game.userGameStatus.state == gameStates.Paused ? <> 
              <button appearance="caution" onPress={mount}>Resume</button>
              <spacer size="small"/>
              <button onPress={() => {
              game.currPage = Pages.Picture;
              const dBlocks:displayBlocks = game.UIdisplayBlocks;
              dBlocks.confirmShowSpot = true;
              game.UIdisplayBlocks = dBlocks;
            }} appearance="destructive">I give up!</button> </>: ""} 
      </hstack>
      <spacer size="small"/>
      {game.userGameStatus.state == gameStates.Paused && game.isUserSubscribed != true ? <>
          <spacer size="small"/>
          <text size="large" weight="bold" wrap color="white"> Join us for daily visual puzzles! </text>
          <spacer size="small"/>
          <button appearance="success" onPress={() => game.subscribeUserToSub()} >Join!</button>
        </>:<text color="white" size="medium" weight="bold"> {game.leaderBoardRec.length > 1 ? game.leaderBoardRec.length+" people have already spotted this.":"Only a few have spotted this." }</text>}

    </vstack>
    );
  
    const GameFinishedBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.60)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center'> You have found the spot(s) in {game.userGameStatus.counter} seconds. You are top {game.getLeaderBoardPercentile(game.userGameStatus.counter).toFixed()}% among the finishers.</text>
        <spacer size="medium"/>
        {game.isUserSubscribed != true ? <>
          <text size="large" weight="bold" wrap color="white"> Join us for daily visual puzzles! </text>
          <spacer size="small"/>
          <button appearance="success" onPress={() => game.subscribeUserToSub()} >Join!</button>
          <spacer size="small"/>
        </>:""}
        <spacer size="small"/>
        <button icon="image-post" appearance="media" onPress={mount} >View image!</button>
        <spacer size="medium"/>
      </vstack>
    );

    const GameAbortedBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.60)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >You have aborted this game.</text>
        <spacer size="small"/>
        <button icon="image-post" appearance="media" onPress={mount} >View image!</button>
        <spacer size="medium"/>
        {game.isUserSubscribed != true ? <>
          <text size="large" weight="bold" wrap color="white"> Join us for daily visual puzzles! </text>
          <spacer size="small"/>
          <button appearance="success" onPress={() => game.subscribeUserToSub()} >Join!</button>
          <spacer size="small"/>
        </>:""}
        <spacer size="medium"/>
      </vstack>
    );
  
    const MaxAttemptsReachedBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 60)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Sorry, you have used all {maxWrongAttempts} attempts to find the spot and unfortunately the spot is still not found!</text>
      </vstack>
    );

    const HelpBlock = ({ game }: { game: SpottitGame }) => (
      <vstack  width="344px" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
        <hstack padding="small" width="100%">
          <text style="heading" size="large" weight='bold' alignment="middle center" width="100%" color='black'>
              Help
          </text>
        </hstack>
        <vstack height="82%" width="100%" padding="medium">
          <spacer size="small" />
          <hstack alignment='start middle'>
            <icon name="search" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Zoom & pan to have a closer look.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            You can pinch and zoom into the image, and pan by dragging the image as needed.
          </text>

          <spacer size="small" />
          <hstack alignment='start middle'>
            <icon name="conversion" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Marking/registering the spot
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            Double-tap/double-click on the spot to register after you find the spot. 
          </text>

          <spacer size="small" />
          <hstack alignment='start middle'>
            <icon name="external" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; View Full Image.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            You can view full image by clicking on the external icon.
          </text> 
          
          <spacer size="small" />
          <hstack alignment='start middle'>
            <icon name="show" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Abort game and show spot.
            </text>
          </hstack>
          <spacer size="xsmall" />
          <hstack>
            <text style="body" wrap size="medium" color='black'>
              Click on 'I give up!' button to abort game and show the spot.
            </text>
          </hstack>
    
          <spacer size="small" />  
          <hstack alignment='start middle'>
            <icon name="list-numbered" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; View leaderboard.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            Check time of other participants by clicking on `Leaderboard` button.
          </text> 
          <spacer size="small" />

        </vstack>
        <hstack alignment="bottom center" width="100%" height="8%">
          <button size="small" icon='close' onPress={() => game.hideHelpBlock()}>Close</button>
        </hstack>
      </vstack>
    );

    const PictureBlock = ({ game }: { game: SpottitGame }) => (
      <zstack alignment="top start" width="344px" height="100%" cornerRadius="small" border="none">
        <hstack width="344px" height="100%" alignment= "top start" backgroundColor='#555'>
          <image
            width= "344px" 
            height="460.8px" 
            url= {game.imageURL}
            imageHeight={752}
            imageWidth={752}
            resizeMode="fit"
          />
        </hstack>

        {getPictureTilesBlock(game)}
        {getPictureOverlayBlock(game)}
      </zstack>
    );

    function getPictureTilesBlock( game:SpottitGame) {
      return <PictureTiles  game={game} />
    }

    function getPictureOverlayBlock( game:SpottitGame) {

      if ( game.userGameStatus.state == gameStates.Aborted && !game.UIdisplayBlocks.spots ) {
        return <GameAbortedBlock game={game} />;
      }
      else if( game.UIdisplayBlocks.confirmShowSpot ) {
        return <ConfirmShowSpotBlock game={game}/>;
      }
      else if( game.userIsAuthor && game.validTileSpotsMarkingDone && !game.UIdisplayBlocks.spots ) {
        return  <InfoBlock game={game} />;
      }
      else if( !game.userIsAuthor && game.userGameStatus.state != gameStates.Finished && game.validTileSpotsMarkingDone && game.userGameStatus.state != gameStates.Aborted  )  {
        return <GameStartBlock game={game}/>;
      }
      else if (game.userGameStatus.state == gameStates.Finished) {
        return <GameFinishedBlock game={game} />;
      }
      return null;
    }

    const myPostId = context.postId ?? 'defaultPostId';
    const game = new SpottitGame(context, myPostId);

    const {currentPage, currentItems, toNextPage, toPrevPage} = usePagination(context, game.leaderBoardRec, leaderBoardPageSize);
    
    const pixels = game.tilesData.map((pixel, index) => (
      <hstack
        onPress={() => {
          if( !game.validTileSpotsMarkingDone && game.userIsAuthor ) {
            game.toggleValidTile(index);
          } 
          else if( game.userGameStatus.state == gameStates.Started && !game.userIsAuthor ){
            game.checkIfTileIsValid(index);
          }
        }}

        width = {`${sizexBlocks}px`}
        height = {`${sizeyBlocks}px`}

        backgroundColor={ game.UIdisplayBlocks.spots && pixel != 0 ? 'rgba(255, 69, 0, 0.9)' : 'transparent'}   border={ game.UIdisplayBlocks.spots && !game.validTileSpotsMarkingDone? "thin":"none"} borderColor='rgba(28, 29, 28, 0.70)'>
      </hstack>
    ));

    const PictureTiles = ({ game }: { game: SpottitGame }) => (
      <vstack
        cornerRadius="small"
        border="none"
        height={PictureTilesHeight}
        width={PictureTilesWidth}
        backgroundColor='transparent'
      >
        {splitArray(pixels, resolutionx).map((row) => (
          <hstack height="2.5%">{row}</hstack>
        ))}
      </vstack>
    );

    const StatusBlock = ({ game }: { game: SpottitGame }) => game.userGameStatus.state == gameStates.Started &&  (
      <hstack alignment="top end">
        <text style="body" size='medium' weight="regular" width="85px">
          Time: {game.userGameStatus.counter}
        </text>
      </hstack> );

    cp = [  <PictureBlock game={game} />,
      <HelpBlock game={game} />,
      <MarkSpotsInfo game={game} />,
      <LeaderBoardBlock game={game} />,
     ];

    if( game.imageURL!="" ) {
      return (
        <blocks height="tall">
          <hstack gap="small" width="100%" height="90%" alignment="middle center" borderColor="transparent" border="none"  >
            {cp[game.currPage]}
          </hstack>
          <hstack alignment="middle center" width="100%" height="10%">
            <button icon="help" size="small" onPress={() => game.showHelpBlock()}>Help</button><spacer size="small" />
            {game.userGameStatus.state != gameStates.Started && game.validTileSpotsMarkingDone ? <>
            <button icon="list-numbered" size="small" onPress={() => game.showLeaderboardBlock()}>Leaderboard</button><spacer size="small" />
            </>:""}
            
            { ( game.userIsAuthor || game.userGameStatus.state == gameStates.Aborted || game.userGameStatus.state == gameStates.Finished ) && game.validTileSpotsMarkingDone ? <><button icon="show" size="small" width="80px" onPress={() => game.toggleSpots()}> { game.UIdisplayBlocks.spots ? "Hide":"Show"} </button>
            </> : "" }
            
            {game.userIsAuthor && !game.validTileSpotsMarkingDone? <><button size="small" onPress={ ()=> game.finishMarkingSpots() }> Done marking!</button></>:""}
            <StatusBlock game={game} />

          </hstack>
        </blocks>
      )
    } else {
        return (
        <blocks height="tall">
        <vstack gap="small" width="100%" height="100%" alignment="middle center" borderColor="transparent" border="none">
            <text wrap width="80%" style="heading" alignment="center middle">This post has expired.</text>
            <text wrap width="80%" style="body" alignment='center middle'>Posts from Spottit app expire after 45 days(Due to current Reddit Developer Platform limitations).</text>
            <spacer size="medium"/>
        </vstack>
        </blocks>);   
    }
  }
})

export default Devvit

const pictureInputForm = Devvit.createForm(  (data) => {
  return {
    title : "Create a Spottit post",
    description:"Use of browser/desktop view is recommended for creating new posts.",
    fields: [
      {
        type: 'string',
        name: 'title',
        label: 'What should they find in the picture?',
        required: true,
        helpText: "Describe what they should search and spot in the picture"
      },
      {  
        type: 'image',
        name: 'postImage',
        label: 'Select picture for your post',
        required: true,
        helpText: "Select JPG or PNG image for your post. Please note that WEBP is presently not supported. Portrait/vertical orientation picture is recommended for better view.",
      },
      {
        type: 'select',
        name: 'flair',
        label: 'Flair for the post',
        options: data.flairOptions,
        helpText: "Select a flair for your post.",
        required: data.flairOptions.length > 0 ? true: false,
      },
    ],
  };
  },
  async (event, context) => {// onSubmit handler
    const ui  = context.ui;
    const reddit = context.reddit;
    const subredditName = await reddit.getCurrentSubredditName();
    const postImage = event.values.postImage;
    const flairId = event.values.flair ? event.values.flair[0] : null;
    var flairText = '';
    const subreddit = await context.reddit.getCurrentSubreddit();
    const flairTemplates = await subreddit.getPostFlairTemplates();
    
    for(var i=0; i< flairTemplates.length; i++ ) {
      if( flairId == flairTemplates[i].id) {
        flairText = flairTemplates[i].text;
      }
    }
  
    let regex = /^https?:\/\/.*\/.*\.(webp)\??.*$/gmi;
    if ( postImage.match(regex)){//Fail request if webp is submitted as this does not seem to be working with present devvit platform.
      ui.showToast({
        text: `WEBP format is presently not supported. Please either select either a JPG or PNG image. Submission failed.`,
        appearance: 'neutral',
      });
      return;
    }  

    const post = await context.reddit.submitPost({
      preview: (// This will show while your post is loading
        <vstack width={'100%'} height={'100%'} alignment="center middle">
        <image
          url="loading.gif"
          description="Loading ..."
          height={'140px'}
          width={'140px'}
          imageHeight={'240px'}
          imageWidth={'240px'}
        />
        <spacer size="small" />
        <text size="large" weight="bold">
          Loading Spottit post...
        </text>
      </vstack>
      ),
      title: `${event.values.title} [Spottit]`,
      subredditName: subredditName,
      flairId: flairId,
      flairText: flairText
    });


    await reddit.setPostFlair({
      postId: post.id,
      subredditName: subredditName,
      text: flairText,
      flairTemplateId: flairId,
    });

    const {redis} = context;
    const myPostId = post.id;
    const currentUsrname = await context.reddit.getCurrentUsername();
    const currentUsrName = currentUsrname ?? "defaultUsername";
    await redis.set(myPostId+'imageURL', postImage, {expiration: expireTime});
    await redis.set(myPostId+'authorName', currentUsrName, {expiration: expireTime} );
    await redis.set(myPostId+'ValidTileSpotsMarkingDone', 'false', {expiration: expireTime});
  
    ui.showToast({
      text: `Successfully created a Spottit post! Please mark the spot that participants should find by going to your post.`,
      appearance: 'success',
    });
    context.ui.navigateTo(post.url);
  } );

Devvit.addMenuItem({
  label: 'Create a Spottit post',
  location: 'subreddit',
  onPress: async (_, context) => {
    await showCreatePostForm(context);
  },
});

async function showCreatePostForm(context:ContextAPIClients) {
  const subreddit = await context.reddit.getCurrentSubreddit();
  const flairTemplates = await subreddit.getPostFlairTemplates();
  const options = flairTemplates.map(template => {
    return { label: template.text, value: template.id };
  });
  
  context.ui.showForm(pictureInputForm, {flairOptions: options});
}

async function getPostExpireTimestamp(context:TriggerContext| ContextAPIClients, postId:string ) {
  const post = await context.reddit.getPostById(postId);
  return post.createdAt.getTime() + redisExpireTimeMilliseconds;
}

async function getLeaderboardRecords(context:TriggerContext| ContextAPIClients, postId:string ) {
  const previousLeaderBoard = await context.redis.hGetAll(postId);
  if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
    var leaderBoardRecords: leaderBoard[] = [];
    for (const key in previousLeaderBoard) {
      const redisLBObj = JSON.parse(previousLeaderBoard[key]);
      if( redisLBObj.username ) {
        const lbObj:leaderBoard = { username: redisLBObj.username, 
                                    timeInSeconds:redisLBObj.timeInSeconds, 
                                    attempts: redisLBObj.attempts,
                                    foundSpots: redisLBObj.hasOwnProperty("foundSpots") ? redisLBObj.foundSpots:[1] };
        leaderBoardRecords.push(lbObj);
      }
    }
    leaderBoardRecords.sort((a, b) =>  b.foundSpots.length - a.foundSpots.length || a.timeInSeconds - b.timeInSeconds );
    return leaderBoardRecords;
  }
  else {//try to get leaderbard records from the archive in comment.
    const redditPostComments = await getRedditPostComments(context, postId);
    for( var i=0; i<redditPostComments.length; i++ ) {
      if( redditPostComments[i].authorName == 'spottit-game' && redditPostComments[i].body.includes("\"leaderboard\"") ) {
        try {
          var pa = JSON.parse(redditPostComments[i].body);

          if( pa.hasOwnProperty("leaderboard") && ! pa.leaderboard[0].hasOwnProperty("foundSpots") ) {
            for( i=0; i< pa.leaderboard.length; i++ ) {
              pa.leaderboard[i].foundSpots = [1];//Default to 1 spot found when the attribute is missing.
            }
          }
          
          const postArchive = pa as postArchive;
          console.log("Retrieved leaderboard records from comment json");
          return postArchive.leaderboard;
        } catch (e) {
          console.log(e);
          continue;//Skip current entry and try next.
        }
      }
    }
  }
  return [];
}

async function getRedditPostComments(context: TriggerContext| ContextAPIClients, postId:string) {
  const comments = await context.reddit
  .getComments({
    postId: postId,
    limit: 100,
    pageSize: 500,
  })
  .all();
  return comments;
}

function floodFillRecursive(grid:number[][], x:number, y:number, targetNumber:number, searchNumber:number) {
  if (x < 0 || x >= grid.length || y < 0
      || y >= grid[0].length ||
      grid[x][y] !== searchNumber) {
      return;
  }

  grid[x][y] = targetNumber;

  floodFillRecursive(grid, x + 1, y, targetNumber, searchNumber);
  floodFillRecursive(grid, x - 1, y, targetNumber, searchNumber);
  floodFillRecursive(grid, x, y + 1, targetNumber, searchNumber);
  floodFillRecursive(grid, x, y - 1, targetNumber, searchNumber);
}