import { ContextAPIClients, UIClient, UseIntervalResult, UseStateResult, Devvit, RedisClient } from '@devvit/public-api';
import { usePagination } from '@devvit/kit';
Devvit.configure({redditAPI: true, redis: true });

const resolutionx = 22;
const resolutiony = 34;
const sizex = 15.59;
const sizey = 16;
const tiles = new Array(resolutionx * resolutiony).fill(0);
const redisExpireTimeSeconds = 2592000;//30 days in seconds.
const maxWrongAttempts = 20;
let dateNow = new Date();
const milliseconds = redisExpireTimeSeconds * 1000;
const expireTime = new Date(dateNow.getTime() + milliseconds);
const leaderBoardPageSize = 13;

type leaderBoard = {
  username: string;
  timeInSeconds: number;
  attempts: number;
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
  LeaderBoard
}

type UserGameState = {
  state: gameStates;
  startTime: number;
  counter: number;
  counterStage: number;
  attemptsCount: number;
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
  private _data: UseStateResult<number[]>;
  private _userIsAuthor: boolean;
  private _redisKeyPrefix: string;

  constructor( context: ContextAPIClients, postId: string) {
    this._context = context;
    this._ui = context.ui;
    this.redis = context.redis;
    this._ScreenIsWide = this.isScreenWide();

    this._counterInterval = context.useInterval( async () => {

      if( this.userGameStatus.state == gameStates.Started && this.userGameStatus.attemptsCount < maxWrongAttempts) {
        var timeNow = new Date().getTime();
        const ugs = this.userGameStatus;
        ugs.counter = Math.floor ( (timeNow - ugs.startTime ) / 1000 );
  
        if( this.userGameStatus.counter - this.userGameStatus.counterStage > 5 ) {//Every 5 seconds, put the counter to redis for tracking.
          this.userGameStatus.counterStage = this.userGameStatus.counter
          await this.redis.set(this.redisKeyPrefix+'CounterTracker', this.userGameStatus.counter.toString(), {expiration: expireTime} );
          await this.redis.set(this.redisKeyPrefix+'AttemptsCount', this.userGameStatus.attemptsCount.toString(), {expiration: expireTime} );
        }
        this.userGameStatus = ugs;
      }

    }, 1000);

    this._myPostId = context.useState(async () => {
      return postId;
    });

    this._currPage = context.useState(async () => {
      return Pages.Picture;
    });
  
    this._currentUsername = context.useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      return currentUser?.username??'defaultUsername';
    });

    this._redisKeyPrefix = this.myPostId + this.currentUsername;

    this._authorName = context.useState(async () => {
      const authorName = await this.redis.get(this.myPostId+'authorName');
      if (authorName) {
          return authorName;
      }
      return "";
    });

    this._userGameStatus = context.useState<UserGameState>(
      async() =>{
        const UGS:UserGameState = {state: gameStates.NotStarted, startTime: 0, counter: 0, counterStage: 0, attemptsCount: 0 };
        const redisValues = await this.redis.mGet([ this.redisKeyPrefix+'GameAborted', 
                                                    this.redisKeyPrefix+'CounterTracker', 
                                                    this.redisKeyPrefix+'AttemptsCount']);

        if(redisValues && redisValues.length == 3)
        {
          if (redisValues[0] === 'true' ) {
            UGS.state = gameStates.Aborted;
          }
          else
          if (redisValues[1] && redisValues[1].length > 0 ) {
            var counterIntValue = parseInt(redisValues[1]);
            UGS.counter = UGS.counterStage = counterIntValue;
            UGS.state = gameStates.Paused;
          }

          if (redisValues[2] && redisValues[2].length > 0 ) {
            var attemptsCountIntValue = parseInt(redisValues[2]);
            UGS.attemptsCount = attemptsCountIntValue;
            if( UGS.attemptsCount >= maxWrongAttempts ) {
              UGS.state = gameStates.Aborted;
            }
          }
        }
        return UGS;
      }
    );

    this._validTileSpotsMarkingDone = context.useState(async () => {
      const ValidTileSpotsMarkingDone = await context.redis.get(this.myPostId+'ValidTileSpotsMarkingDone');
      if( ValidTileSpotsMarkingDone &&  ValidTileSpotsMarkingDone == 'true') {
        return true;
      }
      if( this.userIsAuthor ) {
        this.currPage = Pages.MarkSpotsInfo;
      }
      return false;
    });

    this._UIdisplayBlocks = context.useState<displayBlocks>(() =>{
      const dBlocks:displayBlocks = {help:false, 
        picture: this.userIsAuthor && !this.validTileSpotsMarkingDone && !this._ScreenIsWide ? false:  true,
        spotTiles: this.userIsAuthor || this.userGameStatus.state == gameStates.Started || this.userGameStatus.state == gameStates.Aborted,
        spots: !this.validTileSpotsMarkingDone || this.userGameStatus.state == gameStates.Aborted ? true: false,
        zoomView: false,
        zoomAlignment: "top start",
        zoomSelect:false,
        confirmShowSpot:false,
        leaderBoard: false,
        MarkSpotsInfo: !this.validTileSpotsMarkingDone && this.userIsAuthor,
        Info: false};
      return dBlocks;
    });

    this._leaderBoardRec = context.useState(async () => {//Get Leaderboard records.
      const previousLeaderBoard = await context.redis.hGetAll(this.myPostId);
      if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
        var leaderBoardRecords: leaderBoard[] = [];
        for (const key in previousLeaderBoard) {
          const redisLBObj = JSON.parse(previousLeaderBoard[key]);
          if( redisLBObj.username ) {
            if(redisLBObj.username == this.currentUsername) {
              const usg = this._userGameStatus[0];
              usg.state = gameStates.Finished;
              usg.counter = redisLBObj.timeInSeconds;
              usg.attemptsCount = redisLBObj.attempts;
              this.userGameStatus = usg;
            }
            const lbObj:leaderBoard = {username: redisLBObj.username, timeInSeconds:redisLBObj.timeInSeconds, attempts: redisLBObj.attempts };
            leaderBoardRecords.push(lbObj);
          }
        }
        leaderBoardRecords.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
        return leaderBoardRecords;
      } 
      return [];
    });

    this._imageURL = context.useState(async () => {
      const imageURL = await context.redis.get(this.myPostId+'imageURL');
      if (imageURL) {
        return imageURL;
      }
      return "";
    });

    this._data = context.useState(
      async () => {
        const tilesDataStr = await context.redis.get(this.myPostId+'TilesDataArray');
        if (tilesDataStr && tilesDataStr.length > 0 ) {
          return tilesDataStr.split(",").map(Number);
        }
        return tiles;//default to empty array.
      }
    );

    this._userIsAuthor = this.currentUsername == this.authorName;
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

  get imageURL() {
    return this._imageURL[0];
  }

  public set UIdisplayBlocks(value: displayBlocks) {
    this._UIdisplayBlocks[0] = value;
    this._UIdisplayBlocks[1](value);
  }

  public set validTileSpotsMarkingDone(value: boolean) {
    this._validTileSpotsMarkingDone[0] = value;
    this._validTileSpotsMarkingDone[1](value);
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

  private set data(value: number[]) {
    this._data[0] = value;
    this._data[1](value);
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

  public get data() {
    return this._data[0];
  }

  public get validTileSpotsMarkingDone() {
    return this._validTileSpotsMarkingDone[0];
  }
  
  public get myPostId() {
    return this._myPostId[0];
  }

  public get currentUsername() {
    return this._currentUsername[0];
  }

  private isScreenWide() {
    const width = this._context.dimensions?.width ?? null;
    return width == null ||  width < 688 ? false : true;
  }

  public async toggleValidTile( index=0 ) {
    var d = this.data;
    if( d[index] == 1 ) {
      d[index] = 0;
    }
    else
    {
      d[index] = 1;
    }
    this.data = d;
  }

  public async finishMarkingSpots() {
    if( this.data.find((element) => element == 1) ) 
    {
      const dBlocks:displayBlocks = this.UIdisplayBlocks;
      this.validTileSpotsMarkingDone = true;
      await this.redis.set(this.myPostId+'ValidTileSpotsMarkingDone', 'true', {expiration: expireTime});
      const redisDataStr = this.data.join(","); 
      await this.redis.set(this.myPostId+'TilesDataArray', redisDataStr, {expiration: expireTime});
      dBlocks.spots = false;
      this.UIdisplayBlocks = dBlocks;
    }
    else {
      this._context.ui.showToast({
        text: "There are no tiles selected. Please select the tiles to mark spot that participants must find.",
        appearance: 'neutral',
      });
    }
  }

  public async showTheSpotAndAbort(){
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    await this.redis.set(this.redisKeyPrefix+'GameAborted', 'true', {expiration: expireTime});
    const ugs = this.userGameStatus;
    ugs.state = gameStates.Aborted;
    this.userGameStatus = ugs;
    dBlocks.spots = true;
    dBlocks.confirmShowSpot = false;
    this._context.ui.showToast({
      text: "You can find the object/thing behind the dark spots shown!",
      appearance: 'neutral',
    });
    this.UIdisplayBlocks = dBlocks;
  }

  public async deleteLeaderboardRec(username: string) {//TODO: Add confirmation dialog
    const leaderBoardArray = this.leaderBoardRec;
    var updatedLeaderBoardArray = this.leaderBoardRec;
    for(var i=0; i< leaderBoardArray.length; i++ ) {
      if( leaderBoardArray[i].username == username) {
        updatedLeaderBoardArray.splice(i, i+1);
      }
    }
    this.leaderBoardRec = updatedLeaderBoardArray;
    await this.redis.hDel(this.myPostId, [username]);
  }

  public async finishGame() {
    this._context.ui.showToast({
      text: "You have successfully found the spot in "+this.userGameStatus.counter+" seconds, Congratulations!",
      appearance: 'success',
    });
    const ugs = this.userGameStatus;    
    ugs.state = gameStates.Finished;
    const leaderBoardArray = this.leaderBoardRec;
    const leaderBoardObj:leaderBoard  = { username:this.currentUsername, timeInSeconds: this.userGameStatus.counter, attempts: this.userGameStatus.attemptsCount };
    leaderBoardArray.push(leaderBoardObj);
    leaderBoardArray.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
    this.leaderBoardRec = leaderBoardArray;
    await this.redis.hSet(this.myPostId, { [this.currentUsername]: JSON.stringify(leaderBoardObj) }), {expiration: expireTime};
    this.userGameStatus = ugs;
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
    if( this._data[0][index] ==  1 && this.userGameStatus.counter > 0 ) {
      await this.finishGame();
    }
    else {
      await this.incrementAttempts();
    }
  }

  public async openIntroPage(){
    this._context.ui.navigateTo('https://www.reddit.com/r/Spottit/comments/1ethp30/introduction_to_spottit_game/');
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

  public toggleZoomSelect() {
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    if( dBlocks.zoomView ){ //If already in zoom view, reset zoom and go back to full picture view
      dBlocks.spotTiles = true;
      dBlocks.zoomSelect = false;
      dBlocks.zoomView = false;
    }
    else if( dBlocks.zoomSelect ) {
      dBlocks.zoomSelect = false;
      dBlocks.spotTiles = true;
    }
    else {
      dBlocks.zoomSelect = true;
      dBlocks.spotTiles = false;
      this._context.ui.showToast({
        text: "Please select a block to zoom into.",
        appearance: 'neutral',
      });
    }
    this.UIdisplayBlocks = dBlocks;
  }

  public showHelpBlock() {
    this.currPage = Pages.Help;
  }
  
  public showLeaderboardBlock() {
    this.currPage = Pages.LeaderBoard;
  }

  public hideLeaderboardBlock() {
    this.currPage = Pages.Picture;
  }

  public hideHelpBlock() {
    this.currPage = Pages.Picture;
  }

  public async startOrResumeGame(){
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    const ugs = this.userGameStatus;
    ugs.state = gameStates.Started;
    ugs.startTime = new Date().getTime() -  (this.userGameStatus.counterStage * 1000 );
    this.userGameStatus = ugs;
    dBlocks.spots = false;
    dBlocks.spotTiles = true;
    this.UIdisplayBlocks = dBlocks;
    this._counterInterval.start();
    await this.redis.set(this.redisKeyPrefix+'GameAborted', 'false', {expiration: expireTime});
  }

  public showZoomView(alignment:Devvit.Blocks.Alignment){
    const dBlocks:displayBlocks = this.UIdisplayBlocks;
    dBlocks.zoomView = true;
    dBlocks.zoomAlignment = alignment;
    dBlocks.zoomSelect = false;
    this.UIdisplayBlocks = dBlocks;
    this._context.ui.showToast({text: `Click on the zoom icon again to zoom out`,
      appearance: 'neutral'});
  }

}

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

Devvit.addCustomPostType({
  name: 'Spottit Post',
  height: 'tall',
  render: context => {
    let cp: JSX.Element[];
 
    const openUserPage = async (username: string) => {
      context.ui.navigateTo(`https://www.reddit.com/user/${username}/`);
    };

    const PictureTilesWidth = `${resolutionx * sizex}px`;
    const PictureTilesHeight = `${resolutiony * sizey}px`;

    function splitArray<T>(array: T[], segmentLength: number): T[][] {
      const result: T[][] = [];
      for (let i = 0; i < array.length; i += segmentLength) {
        result.push(array.slice(i, i + segmentLength));
      }
      return result;
    }

    function getQuadrant<T>(quadrantNumber: number, array: T[],segmentLength: number) {
      const q1: T[][] = [];
      const q2: T[][] = [];
      const q3: T[][] = [];
      const q4: T[][] = [];
  
      for (let i = 0; i < array.length/2; i += segmentLength) {
          q1.push(array.slice(i, i + (segmentLength/2) ));
          q2.push(array.slice(i + (segmentLength/2), i + (segmentLength) ));
      }

      if( quadrantNumber == 1 ) {
        return q1;
      }
      else if( quadrantNumber == 2 ) {
        return q2;
      }

      for (let i = array.length/2; i < array.length; i += segmentLength) {
          q3.push(array.slice(i, i + (segmentLength/2) ));
          q4.push(array.slice(i + (segmentLength/2), i + (segmentLength) ));
      }
  
      if( quadrantNumber == 3 ) {
          return q3;
      }
      
      return q4;
  }    
    
    const LeaderBoardBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="96%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="275px" color='black'>
                &nbsp;&nbsp;&nbsp;&nbsp;Leaderboard
            </text>
            <button size="small" icon='close' width="34px" onPress={() => game.hideLeaderboardBlock()}></button>
          </hstack>
          <hstack padding="small" width="100%" backgroundColor="#c0c0c0" height="8%">
            <text style="heading" size="small" color="black" width="15%">
             Rank
            </text>
            <text style="heading" size="small" color="black" width="50%">
             Username
            </text>
            <text style="heading" size="small" color="black" width="30%" alignment="start">
              Total Time
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
      return (<hstack padding="xsmall">
        <text style="body" size="small" weight="bold" color="black" width="15%">
          {index}
        </text>
        <text style="body" size="small" weight="bold" color="black" onPress={() => openUserPage(row.username)} width="50%">
          {row.username}
        </text>
        <text style="body" size="small" color="black" width="30%" alignment="start">
          &nbsp;{row.timeInSeconds}
        </text>
        { game.userIsAuthor ? <text size="small" color="black" onPress={() => game.deleteLeaderboardRec(row.username)} width="5%">X</text>: ""}
        </hstack>
      );
    };

    const InfoBlock = ({ game }: { game: SpottitGame }) => (     
    <vstack width="344px" height={'100%'} alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
      <hstack>
        <vstack width="300px" alignment='center middle'>
          <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center'>
            Your Spottit post is ready for others to play. There have been {game.leaderBoardRec.length} players who have taken part so far.
          </text>
          <spacer size="medium"/>
          <button appearance="success" onPress={async ()=>await showCreatePostForm(context)} icon='add' width="180px"> Create a new post  </button>
        </vstack>
      </hstack>
    </vstack>
    );

    const ConfirmShowSpotBlock = ({ game }: { game: SpottitGame }) => (
      <hstack width="344px" height="100%" alignment="center middle" backgroundColor='transparent'>
        <vstack  width="320px" height="45%" alignment="center middle" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="270px" color='black'>
                &nbsp;Are you sure to abort & view?
            </text>
            <button size="small" icon='close' width="34px" onPress={() => {
                const dBlocks:displayBlocks = game.UIdisplayBlocks;
                dBlocks.confirmShowSpot = false;
                game.UIdisplayBlocks = dBlocks;
              }}></button>
          </hstack>
          <vstack height="80%" width="100%" padding="medium">
            <text wrap color='black'>
            Are you sure you want to view the spot? This will abort this game and you will not be able to resume again.
            </text>
            <spacer size="large" />
            <hstack alignment="bottom center" width="100%">
              <button size="small" icon='checkmark' onPress={() => game.showTheSpotAndAbort()}>Yes</button>
              <spacer size="medium" />
              <button size="small" icon='close' onPress={() => {
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
              Wait a bit after each click for the box to fill with dark colour (there could be a little delay). To undo marking, click on the marked tile again.
            </text>
            <spacer size="small"></spacer>
            <text width="300px" size="small" style='body' weight="regular" wrap color="black">
            After marking all the tiles, Click on 'Done marking!'.
            </text>
            <spacer size="small"></spacer>

            <button size="small" icon='joined' onPress={() => {
                                game.currPage = Pages.Picture;
              }}>Start marking!</button>
          </vstack>
        </hstack>
      </vstack>
      );

    const GameStartBlock = ({ game }: { game: SpottitGame }) => (
    <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(0, 0, 0, 0.75)'>
      <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Click '{ game.userGameStatus.state == gameStates.Paused ? "Resume!" :"Start!"}' when you're ready to find the spot!</text>
      <spacer size="small"/>
      <button appearance="success" onPress={()=> game.startOrResumeGame()} > { game.userGameStatus.counterStage == 0 ? "Start!": "Resume!"}  </button>
    </vstack>
    );
  
    const GameFinishedBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >You have found the spot in {game.userGameStatus.counter} seconds! Click on Leaderboard button to see time of others. </text>
        <spacer size="medium"/>
        <button appearance="success" onPress={async ()=>await showCreatePostForm(context)} icon='add' width="180px"> Create a new post  </button>
      </vstack>
    );

    const MaxAttemptsReachedBlock = ({ game }: { game: SpottitGame }) => (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Sorry, you have used all {maxWrongAttempts} attempts to find the spot and unfortunately the spot is still not found!</text>
      </vstack>
    );

    const HelpBlock = ({ game }: { game: SpottitGame }) => (
      <vstack  width="344px" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
        <hstack padding="small" width="100%">
          <text style="heading" size="medium" weight='bold' alignment="middle center" width="100%" color='black'>
              Help
          </text>
        </hstack>
        <vstack height="82%" width="100%" padding="medium">
          <hstack alignment='start middle'>
            <icon name="tap" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Find the spot in picture!
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
                Find what's described in post title and click/tap on it when you spot it.
          </text>
          <spacer size="small" />

          <hstack alignment='start middle'>
            <icon name="search" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Zoom to have a closer look.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            Click zoom icon and select a quadrant to zoom into. To zoom-out, click on zoom icon again.
          </text>
          <spacer size="small" />

          <hstack alignment='start middle'>
            <icon name="show" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Abort game and show spot.
            </text>
          </hstack>
          <spacer size="small" />

          <hstack>
            <text style="body" wrap size="medium" color='black'>
              Click on&nbsp;
            </text>
            <icon name="show" size='small' color='black'></icon>
            <text style="body" wrap size="medium" color='black'>
              &nbsp;icon to abort game and show spot.
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
            View time taken by other participants by clicking on `Leaderboard` button.
          </text> 
          <spacer size="small" />

          <hstack alignment='start middle'>
            <icon name="add" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Create a new post.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            Create a new post by clicking on `+` button. For more information, click here: 
          </text>
          <button appearance="success" size="small" icon='info' onPress={async () => await game.openIntroPage()}>Introduction to Spottit</button>

        </vstack>
        <hstack alignment="bottom center" width="100%" height="8%">
          <button size="small" icon='close' onPress={() => game.hideHelpBlock()}>Close</button>
        </hstack>
      </vstack>
    );

    const PictureBlock = ({ game }: { game: SpottitGame }) => (
      <zstack alignment="top start" width="344px" height="100%" cornerRadius="small" border="none">
        <hstack width="344px" height="100%" alignment= { game.UIdisplayBlocks.zoomView? game.UIdisplayBlocks.zoomAlignment : "top start"} backgroundColor='transparent'  onPress={() => {
          if( game.UIdisplayBlocks.zoomView) {
            const dBlocks:displayBlocks = game.UIdisplayBlocks;
            dBlocks.zoomView = false;
            dBlocks.zoomSelect = true;
            game.UIdisplayBlocks = dBlocks;
          }
        }}>
          <image
            width= {game.UIdisplayBlocks.zoomView ? "688px" : "344px"}
            height={game.UIdisplayBlocks.zoomView ? "921.6px" : "460.8px"}
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

      if( ! game.UIdisplayBlocks.zoomView) {
        return <PictureTiles  game={game} />
      }
      var quadrantNumber = 1;
      switch( game.UIdisplayBlocks.zoomAlignment) {
        case "top end":
          quadrantNumber = 2;
        break;
        case "bottom start":
          quadrantNumber = 3;
        break;
        case "bottom end":
          quadrantNumber = 4;
        break;
      }

      var q = getQuadrant(quadrantNumber, game.data, resolutionx);
      let rows: JSX.Element[] = [];
      let border:Devvit.Blocks.Thickness="none";

      if( ! game.validTileSpotsMarkingDone ) {
        border="thin";
      }

      for( var i=0; i< q.length; i++) {
        let columns: JSX.Element[] = [];
        for(var j =0; j< q[i].length; j++) {
           var bg_color =  'transparent'
           let onTilePress = async () => {
            await game.incrementAttempts();
          }
          if( q[i][j] == 1 ) {
            if( game.UIdisplayBlocks.spots ){
              bg_color = 'rgba(28, 29, 28, 0.70)';
            }
            onTilePress = async () => {
              if( game.userGameStatus.state == gameStates.Started ) {
                await game.finishGame();
              }
            }
          }
          columns.push ( <hstack
          onPress={onTilePress}
          width = {`${sizex * 2}px`}
          height = {`${sizey * 2}px`}
          backgroundColor={bg_color}  borderColor='rgba(28, 29, 28, 0.70)' border={border} >
          </hstack>);
        }

        rows.push(<hstack height="5%">{columns}</hstack> )
      }

     return <vstack cornerRadius="small" border="none" height={PictureTilesHeight} width={PictureTilesWidth} backgroundColor='transparent' >
        {rows}
      </vstack>;
    }

    function getPictureOverlayBlock( game:SpottitGame) {

      if( game.UIdisplayBlocks.spots ) {
        return null;
      } 
      else if( game.UIdisplayBlocks.confirmShowSpot ) {
        return <ConfirmShowSpotBlock game={game}/>;
      } 
      else if(game.UIdisplayBlocks.zoomSelect ) {
        return  <ZoomSelectBlocks game={game} />;
      }
      else if( game.userIsAuthor && game.validTileSpotsMarkingDone ) {
        return  <InfoBlock game={game} />;
      }
      else if( game.userGameStatus.state == gameStates.Paused ||  (game.userGameStatus.state == gameStates.NotStarted && game.validTileSpotsMarkingDone ) ) {
        return <GameStartBlock game={game}/>;
      }
      else if (game.userGameStatus.state == gameStates.Finished) {
        return <GameFinishedBlock game={game} />;
      }
      else if (game.userGameStatus.state == gameStates.Aborted && game.userGameStatus.attemptsCount == maxWrongAttempts ) {
        return <MaxAttemptsReachedBlock game={game} />;
      }

      return null;
    }

    const ZoomSelectBlocks = ({ game }: { game: SpottitGame }) => (<vstack width="344px" height="100%" alignment="top start" backgroundColor='transparent'>
      <hstack width="344px" height="230.4px">
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => game.showZoomView("top start")}>
        </hstack>
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => game.showZoomView("top end")}>
        </hstack>
      </hstack>
      <hstack width="344px" height="230.4px">
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => game.showZoomView("bottom start")}>
        </hstack>
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => game.showZoomView("bottom end")}>
        </hstack>
      </hstack>
    </vstack>)

    const myPostId = context.postId ?? 'defaultPostId';
    const game = new SpottitGame(context, myPostId);

    const {currentPage, currentItems, toNextPage, toPrevPage} = usePagination(context, game.leaderBoardRec, leaderBoardPageSize);
    
    const pixels = game.data.map((pixel, index) => (
      <hstack
        onPress={() => {
          if( !game.validTileSpotsMarkingDone && game.userIsAuthor ) {
            game.toggleValidTile(index);
          } 
          else if( game.userGameStatus.state == gameStates.Started && !game.userIsAuthor ){
            game.checkIfTileIsValid(index);
          }
        }}
        width = {`${sizex}px`}
        height = {`${sizey}px`}
        backgroundColor={ game.UIdisplayBlocks.spots && pixel == 1 ? 'rgb(255, 69, 0)' : 'transparent'}   border={ game.UIdisplayBlocks.spots && !game.validTileSpotsMarkingDone? "thin":"none"} borderColor='rgba(28, 29, 28, 0.70)'>
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
        <text style="body" size='medium' weight="regular" width="90px">
          Attempts: {game.userGameStatus.attemptsCount} 
        </text>
      </hstack> );

    cp = [  <PictureBlock game={game} />,
      <HelpBlock game={game} />,
      <MarkSpotsInfo game={game} />,
      <LeaderBoardBlock game={game} />
     ];

    if( game.imageURL!="" ) {
      return (
        <blocks height="tall">
          <hstack gap="small" width="100%" height="90%" alignment="middle center" borderColor="transparent" border="none" >
            {cp[game.currPage]}
          </hstack>
          <hstack alignment="middle center" width="100%" height="10%">
            <button icon="help" size="small" onPress={() => game.showHelpBlock()}></button><spacer size="small" />
            {game.userGameStatus.state != gameStates.Started && game.validTileSpotsMarkingDone ? <>
            <button icon="list-numbered" size="small" onPress={() => game.showLeaderboardBlock()}>Leaderboard</button><spacer size="small" />
            </>:""}

            {game.userGameStatus.state != gameStates.Finished && game.userGameStatus.state != gameStates.Started && !game.userIsAuthor ? <>
            <button icon='add' appearance="success" size="small" onPress={async ()=>await showCreatePostForm(context)}></button>
            <spacer size="small" />
            </>:""}
            
            {game.userGameStatus.state == gameStates.Started? <><button icon="show" size="small" onPress={() => {
              const dBlocks:displayBlocks = game.UIdisplayBlocks;
              dBlocks.confirmShowSpot = true;
              game.UIdisplayBlocks = dBlocks;
            }}></button><spacer size="small" />
            <button icon={ (game.UIdisplayBlocks.zoomView || game.UIdisplayBlocks.zoomSelect ) ? "search-fill" :  "search" } size="small" onPress={() => game.toggleZoomSelect()} appearance={ (game.UIdisplayBlocks.zoomView || game.UIdisplayBlocks.zoomSelect ) ? "success" :  "secondary" } ></button>
            <spacer size="small" /></>: ""}
            
            { ( game.userIsAuthor || game.userGameStatus.state == gameStates.Aborted || game.userGameStatus.state == gameStates.Finished ) && game.validTileSpotsMarkingDone ? <><button icon="show" size="small" width="140px" onPress={() => game.toggleSpots()}> { game.UIdisplayBlocks.spots ? "Hide spots":"Show spots"} </button><spacer size="small" /></> : "" }
            
            {game.userIsAuthor && !game.validTileSpotsMarkingDone? <><button size="small" onPress={ ()=> game.finishMarkingSpots() }> Done marking!</button></>:""}
            <StatusBlock game={game} />
          </hstack>
        </blocks>
      )
    } else {
        return (
        <blocks height="tall">
        <vstack gap="small" width="100%" height="100%" alignment="middle center" borderColor="transparent" border="none">
            <text wrap width="80%" style="heading">This post has expired. Posts from Spottit app expires after 30 days(Due to current Reddit Developer Platform limitations).</text>
            <spacer size="medium"/>
            <button appearance="success" onPress={async ()=>await showCreatePostForm(context)} icon='add' width="180px"> Create a new post  </button>
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
    const subreddit = await reddit.getCurrentSubreddit();
    const postImage = event.values.postImage;
    const flairId = event.values.flair ? event.values.flair[0] : null;

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
      subredditName: subreddit.name,
      flairId: flairId
    });
  
    const {redis} = context;
    const myPostId = post.id;
    const currentUsr = await context.reddit.getCurrentUser();
    const currentUsrName = currentUsr?.username ?? "";
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
