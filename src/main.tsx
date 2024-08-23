import {Devvit} from '@devvit/public-api'
Devvit.configure({redditAPI: true, redis: true });
import { usePagination } from '@devvit/kit';

const resolutionx = 22;
const resolutiony = 40;
const size = 16;
const tiles = new Array(resolutionx * resolutiony).fill(0);
const redisExpireTimeSeconds = 1728000;//20 days in seconds.
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

type UserGameState = {
  state: gameStates;
  startTime: number;
  counter: number;
  counterStage: number;
  attemptsCount: number;
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
    const { useState } = context;
    const {redis, postId } = context;
    const myPostId = postId ?? 'defaultPostId';
    const ScreenIsWide = isScreenWide();
    const [data, setData] = useState(
      async () => {
        const tilesDataStr = await redis.get(myPostId+'TilesDataArray');
        if (tilesDataStr && tilesDataStr.length > 0 ) {
          return tilesDataStr.split(",").map(Number);
        }
        return tiles;//default to empty array.
      }
    );

    const [currentUsername] = useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      return currentUser?.username;
    });
    const [authorName] = useState(async () => {
      const authorName = await redis.get(myPostId+'authorName');
      if (authorName) {
          return authorName;
      }
      return "";
    });

    const [validTileSpotsMarkingDone, setValidTileSpotsMarkingDone] = useState(async () => {
      const ValidTileSpotsMarkingDone = await redis.get(myPostId+'ValidTileSpotsMarkingDone');
      if( ValidTileSpotsMarkingDone &&  ValidTileSpotsMarkingDone == 'true') {
        return true;
      }
      return false;
    });

    const [userGameStatus, setUserGameStatus] = useState<UserGameState>(
      async() =>{
        const UGS:UserGameState = {state: gameStates.NotStarted, startTime: 0, counter: 0, counterStage: 0, attemptsCount: 0 };
        const redisValues = await redis.mget([myPostId+currentUsername+'GameAborted', myPostId+currentUsername+'CounterTracker', myPostId+currentUsername+'AttemptsCount']);
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

    const [leaderBoardRec, setLeaderBoardRec] = useState(async () => {//Get Leaderboard records.
      const previousLeaderBoard = await redis.hgetall(myPostId);
      if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
        var leaderBoardRecords: leaderBoard[] = [];
        for (const key in previousLeaderBoard) {
          const redisLBObj = JSON.parse(previousLeaderBoard[key]);
          if( redisLBObj.username ) {
            if(redisLBObj.username == currentUsername) {
              const usg = userGameStatus;
              usg.state = gameStates.Finished;
              usg.counter = redisLBObj.timeInSeconds;
              usg.attemptsCount = redisLBObj.attempts;
              setUserGameStatus(usg);
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

    const {currentPage, currentItems, toNextPage, toPrevPage} = usePagination(context, leaderBoardRec, leaderBoardPageSize);

    const [imageURL] = useState(async () => {
      const imageURL = await redis.get(myPostId+'imageURL');
      if (imageURL) {
          return imageURL;
      }
      return "";
    });

    const [UIdisplayBlocks, setUIdisplayBlocks] = useState<displayBlocks>(() =>{
      const dBlocks:displayBlocks = {help:false, 
        picture: (authorName == currentUsername) && !validTileSpotsMarkingDone && !ScreenIsWide ? false:  true,
        spotTiles:  (authorName == currentUsername) || userGameStatus.state == gameStates.Started || userGameStatus.state == gameStates.Aborted,
        spots: !validTileSpotsMarkingDone || userGameStatus.state == gameStates.Aborted ? true: false,
        zoomView: false,
        zoomAlignment: "top start",
        zoomSelect:false,
        confirmShowSpot:false,
        leaderBoard: false,
        MarkSpotsInfo: !validTileSpotsMarkingDone && authorName == currentUsername,
        Info: false};
      return dBlocks;
    });

    const openUserPage = async (username: string) => {
      context.ui.navigateTo(`https://www.reddit.com/user/${username}/`);
    };

    const incrementCounter = async () => {
      if( userGameStatus.state == gameStates.Started && userGameStatus.attemptsCount < maxWrongAttempts) {
        var timeNow = new Date().getTime();
        const ugs = userGameStatus;
        ugs.counter = Math.floor ( (timeNow - ugs.startTime ) / 1000 );

        if( userGameStatus.counter - userGameStatus.counterStage > 5 ) {//Every 5 seconds, put the counter to redis for tracking.
          userGameStatus.counterStage = userGameStatus.counter
          await redis.set(myPostId+currentUsername+'CounterTracker', userGameStatus.counter.toString(), {expiration: expireTime} );
        }
        setUserGameStatus(ugs);
      }
    }

    context.useInterval(incrementCounter, 1000).start();

    function showFullPicture() {
      context.ui.navigateTo(imageURL);
    }

    async function toggleValidTile(context:Devvit.Context, index=0) {
      var d = data;
      if(d[index] == 1 ) {
        d[index] = 0;
      }
      else
      {
        d[index] = 1;
      }
      setData(d);
    }

    async function checkIfTileIsValid(context:Devvit.Context, index:number) {
      const ugs = userGameStatus;
      if( data[index] ==  1 && userGameStatus.counter > 0 ) {
        
        context.ui.showToast({
          text: "You have successfully found the spot in "+userGameStatus.counter+" seconds, Congratulations!",
          appearance: 'success',
        });
        
        ugs.state = gameStates.Finished
        setUserGameStatus(ugs);
        const username = currentUsername?? 'defaultUsername';
        const leaderBoardArray = leaderBoardRec;
        const leaderBoardObj:leaderBoard  = { username:username, timeInSeconds: userGameStatus.counter, attempts: userGameStatus.attemptsCount };
        leaderBoardArray.push(leaderBoardObj);
        leaderBoardArray.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
        setLeaderBoardRec(leaderBoardArray);
        await redis.hset(myPostId, { [username]: JSON.stringify(leaderBoardObj) }), {expiration: expireTime};
      }
      else {
        context.ui.showToast({
          text: "Sorry, that is not the right spot!",
          appearance: 'neutral',
        });        
        ugs.attemptsCount = ugs.attemptsCount + 1;
        await redis.set(myPostId+currentUsername+'AttemptsCount', ugs.attemptsCount.toString(), {expiration: expireTime});

        if (ugs.attemptsCount >= maxWrongAttempts ) {
          await redis.set(myPostId+currentUsername+'GameAborted', 'true', {expiration: expireTime});
          ugs.state = gameStates.Aborted;
        }
      }
      setUserGameStatus(ugs);
    }
    
    async function deleteLeaderboardRec(username: string) {//TODO: Add confirmation dialog
      const leaderBoardArray = leaderBoardRec;
      var updatedLeaderBoardArray = leaderBoardRec;
      for(var i=0; i< leaderBoardArray.length; i++ ) {
        if( leaderBoardArray[i].username == username) {
          updatedLeaderBoardArray.splice(i, i+1);
        }
      }
      setLeaderBoardRec(updatedLeaderBoardArray);
      await redis.hdel(myPostId, [username]);
    }

    function isScreenWide() {
      const width = context.dimensions?.width ?? null;
      return width == null ||  width < 688 ? false : true;
    }

    const PictureTilesWidth = `${resolutionx * size}px`;
    const PictureTilesHeight = `${resolutiony * size}px`;

    function splitArray<T>(array: T[], segmentLength: number): T[][] {
      const result: T[][] = [];
      for (let i = 0; i < array.length; i += segmentLength) {
        result.push(array.slice(i, i + segmentLength));
      }
      return result;
    }
    
    const PictureTiles = () => UIdisplayBlocks.spotTiles && (
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

    const pixels = data.map((pixel, index) => (
      <hstack
        onPress={() => {
          if( !validTileSpotsMarkingDone ) {
            toggleValidTile(context, index);
          } 
          else if( userGameStatus.state != gameStates.Aborted && currentUsername!= authorName ){
            checkIfTileIsValid(context, index);
          }
        }}
        width = {`${size}px`}
        height = {`${size}px`}
        backgroundColor={ UIdisplayBlocks.spots && pixel == 1 ? 'rgba(28, 29, 28, 0.70)' : 'transparent'}   border={ UIdisplayBlocks.spots && !validTileSpotsMarkingDone? "thin":"none"} borderColor='rgba(28, 29, 28, 0.70)'
      >
      </hstack>
    ));  

    const LeaderBoardBlock = () => UIdisplayBlocks.leaderBoard && (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="96%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="275px" color='black'>
                &nbsp;&nbsp;&nbsp;&nbsp;Leaderboard
            </text>
            <button size="small" icon='close' width="34px" onPress={() => hideLeaderboardBlock()}></button>
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
            <LeaderBoardRow row={row} index={index + 1 + (currentPage * leaderBoardPageSize )} />
            ))}
            {leaderBoardRec.length == 0 ?<text style="body" size="small" color="black" width="100%" alignment="middle" wrap>
              The leaderboard is empty. You could be the first, close this and start the game!
            </text>:""}
          </vstack>
          <hstack alignment="middle center" width="100%" height="10%">
            <button size="small" onPress={toPrevPage} icon="left"/>
            <spacer size="xsmall" /><text alignment="middle" color="black"> Page: {currentPage + 1}</text><spacer size="xsmall" />
            <button size="small" onPress={toNextPage} icon="right"/>
            <spacer size="small" />
            <button size="small" icon='close' onPress={() => hideLeaderboardBlock()}>Close</button>
          </hstack>
          <spacer size="small" />
        </vstack>
      </vstack>
    );

    const LeaderBoardRow = ({row, index}: {row: leaderBoard, index: number}): JSX.Element => {
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
        {currentUsername == authorName? <text size="small" color="black" onPress={() => deleteLeaderboardRec(row.username)} width="5%">X</text>: ""}
        </hstack>
      );
    };

    function toggleSpots() {
      const dBlocks:displayBlocks = UIdisplayBlocks;
      dBlocks.spotTiles = true;
      if( dBlocks.spots ) {
        dBlocks.spots = false;
      }
      else {
        dBlocks.spots = true;
      }
      setUIdisplayBlocks(dBlocks);
    }

    function toggleZoomSelect() {
      const dBlocks:displayBlocks = UIdisplayBlocks;
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
        context.ui.showToast({
          text: "Please select a block to zoom into.",
          appearance: 'neutral',
        });
      }
      setUIdisplayBlocks(dBlocks);
    }

    function showHelpBlock() {
      const dBlocks:displayBlocks = UIdisplayBlocks;
      if( ! ScreenIsWide ) { //Hide picture in small screen to make space.
        dBlocks.picture = false;
      }
      dBlocks.help = true;
      dBlocks.leaderBoard = false;
      setUIdisplayBlocks(dBlocks);
    }
    
    function showLeaderboardBlock() {
      const dBlocks:displayBlocks = UIdisplayBlocks;
      dBlocks.picture = false;
      dBlocks.help = false;
      dBlocks.leaderBoard = true;
      setUIdisplayBlocks(dBlocks);
    }

    function hideLeaderboardBlock() {
      const dBlocks:displayBlocks = UIdisplayBlocks;
      dBlocks.picture = true;
      dBlocks.leaderBoard = false;
      setUIdisplayBlocks(dBlocks);
    }

    function hideHelpBlock() {
      const dBlocks:displayBlocks = UIdisplayBlocks;
      dBlocks.picture = true;
      dBlocks.help = false;
      setUIdisplayBlocks(dBlocks);
    }

    function startOrResumeGame(){
      const dBlocks:displayBlocks = UIdisplayBlocks;
      const ugs = userGameStatus;
      ugs.state = gameStates.Started
      ugs.startTime = new Date().getTime() -  (userGameStatus.counterStage * 1000 );
      setUserGameStatus(ugs);
      dBlocks.spots = false;
      dBlocks.spotTiles = true;
      setUIdisplayBlocks(dBlocks);
    }

    function showZoomView(alignment:Devvit.Blocks.Alignment){
      const dBlocks:displayBlocks = UIdisplayBlocks;
      dBlocks.zoomView = true;
      dBlocks.zoomAlignment = alignment;
      dBlocks.zoomSelect = false;
      setUIdisplayBlocks(dBlocks);
    }

    async function finishMarkingSpots() {
      if( data.find((element) => element == 1) ) 
      {
        const dBlocks:displayBlocks = UIdisplayBlocks;
        setValidTileSpotsMarkingDone(true); 
        await redis.set(myPostId+'ValidTileSpotsMarkingDone', 'true', {expiration: expireTime});
        const redisDataStr = data.join(","); 
        await redis.set(myPostId+'TilesDataArray', redisDataStr, {expiration: expireTime});
        dBlocks.spots = false;
        setUIdisplayBlocks(dBlocks);
      }
      else {
        context.ui.showToast({
          text: "There are no tiles selected. Please select the tiles to mark spot that participants must find.",
          appearance: 'neutral',
        });
      }
    }

    async function showTheSpotAndAbort(){
      const dBlocks:displayBlocks = UIdisplayBlocks;
      await redis.set(myPostId+currentUsername+'GameAborted', 'true', {expiration: expireTime});
      const ugs = userGameStatus;
      ugs.state = gameStates.Aborted;
      setUserGameStatus(ugs);
      dBlocks.spots = true;
      dBlocks.confirmShowSpot = false;
      context.ui.showToast({
        text: "You can find the object/thing behind the dark spots shown!",
        appearance: 'neutral',
      });
      setUIdisplayBlocks(dBlocks);
    }
  
    const InfoBlock = () => !UIdisplayBlocks.spots && authorName == currentUsername && validTileSpotsMarkingDone && (     
    <vstack width="344px" height={'100%'} alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
      <hstack>
        <hstack width="300px" >
          <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center'>
            Your Spottit post is ready for others to play. There have been {leaderBoardRec.length} players who have taken part so far.
          </text>
        </hstack>
      </hstack>
    </vstack>
    );

    const ConfirmShowSpotBlock = () => UIdisplayBlocks.confirmShowSpot && (
      <hstack width="344px" height="100%" alignment="center middle" backgroundColor='transparent'>
        <vstack  width="320px" height="45%" alignment="center middle" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="270px" color='black'>
                &nbsp;Are you sure to abort & view?
            </text>
            <button size="small" icon='close' width="34px" onPress={() => {
                const dBlocks:displayBlocks = UIdisplayBlocks;
                dBlocks.confirmShowSpot = false;
                setUIdisplayBlocks(dBlocks);
              }}></button>
          </hstack>
          <vstack height="80%" width="100%" padding="medium">
            <text wrap color='black'>
            Are you sure you want to view the spot? This will abort this game and you will not be able to resume again.
            </text>
            <spacer size="large" />
            <hstack alignment="bottom center" width="100%">
              <button size="small" icon='checkmark' onPress={() => showTheSpotAndAbort()}>Yes</button>
              <spacer size="medium" />
              <button size="small" icon='close' onPress={() => {
                const dBlocks:displayBlocks = UIdisplayBlocks;
                dBlocks.confirmShowSpot = false;
                setUIdisplayBlocks(dBlocks);
              }}>Cancel</button>
            </hstack>
          </vstack>
        </vstack>
      </hstack>
    );

    const MarkSpotsInfo = () =>  UIdisplayBlocks.MarkSpotsInfo  && (     
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

            <button size="small" icon='close' onPress={() => {
                                const dBlocks:displayBlocks = UIdisplayBlocks;
                                dBlocks.picture = true;
                                dBlocks.MarkSpotsInfo = false;
                                setUIdisplayBlocks(dBlocks);
              }}>Close</button>
          </vstack>
        </hstack>
      </vstack>
      );

    const GameStartBlock = () => (userGameStatus.state == gameStates.NotStarted || userGameStatus.state == gameStates.Paused ) && authorName != currentUsername  && validTileSpotsMarkingDone && (
    <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
      <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Click '{ userGameStatus.state == gameStates.Paused ? "Resume!" :"Start!"}' when you're ready to find the spot!</text>
      <spacer size="small"/>
      <button appearance="success" onPress={()=> startOrResumeGame()} > { userGameStatus.counterStage == 0 ? "Start!": "Resume!"}  </button>
    </vstack>
    );
  
    const GameFinishedBlock = () => authorName != currentUsername && userGameStatus.state == gameStates.Finished && !UIdisplayBlocks.spots && (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >You have found the spot in {userGameStatus.counter} seconds! Click on Leaderboard button to see time of others. </text>
      </vstack>
    );

    const MaxAttemptsReachedBlock = () => userGameStatus.attemptsCount >= maxWrongAttempts && !UIdisplayBlocks.spots && (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Sorry, you have used all {maxWrongAttempts} attempts to find the spot and unfortunately the spot is still not found!</text>
      </vstack>
    );

    const HelpBlock = () => UIdisplayBlocks.help && (
      <vstack  width="344px" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
        <hstack padding="small" width="100%">
          <text style="heading" size="large" weight='bold' alignment="middle center" width="290px" color='black'>
              &nbsp;&nbsp;&nbsp;&nbsp;Help
          </text>
          <button size="small" icon='close' width="34px" onPress={() => hideHelpBlock()}></button>
        </hstack>
        <vstack height="80%" width="100%" padding="medium">
          <hstack alignment='start middle'>
            <icon name="tap" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Find the spot in picture!
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
                Find thing/object in picture as per post title and click/tap on it when you spot it.
          </text>
          <spacer size="medium" />

          <hstack alignment='start middle'>
            <icon name="search" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Zoom to have a closer look.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            You can click on zoom icon and then select block of the image to zoom into. Once you find the thing/object, come back to full view (by clicking on zoom icon again) and click on the spot.
          </text>
          <spacer size="medium" />
          <hstack alignment='start middle'>
            <icon name="show" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; Abort game and show spot.
            </text>
          </hstack>
          <hstack>
            <text style="body" wrap size="medium" color='black'>
              Click on&nbsp;
            </text>
            <icon name="show" size='small' color='black'></icon>
            <text style="body" wrap size="medium" color='black'>
              &nbsp;icon to abort game and show spot.
            </text>
          </hstack>
          <spacer size="medium" />
          
          <hstack alignment='start middle'>
            <icon name="list-numbered" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; View leaderboard.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
                Click on Leaderboard button below to view time taken by participants.
          </text>     
        </vstack>
        <hstack alignment="bottom center" width="100%" height="8%">
          <button size="small" icon='close' onPress={() => hideHelpBlock()}>Close</button>
        </hstack>
      </vstack>
    );

    const PictureBlock = () => UIdisplayBlocks.picture && (
      <zstack alignment="top start" width="344px" height="100%" cornerRadius="small" border="none">
        <hstack width="344px" height="100%" alignment= {UIdisplayBlocks.zoomView? UIdisplayBlocks.zoomAlignment : "top start"} backgroundColor='transparent'  onPress={() => {
          if( UIdisplayBlocks.zoomView) {
            const dBlocks:displayBlocks = UIdisplayBlocks;
            dBlocks.zoomView = false;
            dBlocks.zoomSelect = true;
            setUIdisplayBlocks(dBlocks);
          }
        }}>
          <image
            //width= {UIdisplayBlocks.zoomView ? "688px" : "100%"}
            //height={UIdisplayBlocks.zoomView ? "921.6px" : "100%"}
            width= {UIdisplayBlocks.zoomView ? "688px" : "344px"}
            height={UIdisplayBlocks.zoomView ? "921.6px" : "460.8px"}
            url= {imageURL}
            imageHeight={752}
            imageWidth={752}
            resizeMode="fit"
          />
        </hstack>

        <PictureTiles/>
        <GameStartBlock />
        <GameFinishedBlock />
        <InfoBlock />
        <MaxAttemptsReachedBlock/>
        <ConfirmShowSpotBlock />
        <ZoomSelectBlocks />
      </zstack>
    );

    const ZoomSelectBlocks = () => UIdisplayBlocks.zoomSelect && (<vstack width="344px" height="100%" alignment="top start" backgroundColor='transparent'>
      <hstack width="344px" height="230.4px">
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => showZoomView("top start")}>
        </hstack>
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => showZoomView("top end")}>
        </hstack>
      </hstack>
      <hstack width="344px" height="230.4px">
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => showZoomView("bottom start")}>
        </hstack>
        <hstack width="172px" height="100%" borderColor='rgba(28, 29, 28, 0.70)' border="thin" backgroundColor='transparent' onPress={() => showZoomView("bottom end")}>
        </hstack>
      </hstack>
    </vstack>)

    const StatusBlock = () => userGameStatus.state == gameStates.Started && (
    <hstack alignment="top end">
      <text style="body" size='medium' weight="regular" width="85px">
        Time: {userGameStatus.counter}&nbsp;
      </text>
      <text style="body" size='medium' weight="regular" width="80px">
        Attempts: {userGameStatus.attemptsCount} 
      </text>
    </hstack> );

    if( imageURL!="" ) {
      return (
        <blocks height="tall">
          <hstack gap="small" width="100%" height="90%" alignment="middle center" borderColor="transparent" border="none" >
            <PictureBlock />
            <HelpBlock />
            <MarkSpotsInfo />
            <LeaderBoardBlock />
          </hstack>
          <hstack alignment="middle center" width="100%" height="10%">
            <button icon="help" size="small" onPress={() => showHelpBlock()}></button><spacer size="small" />
            {userGameStatus.state != gameStates.Started && validTileSpotsMarkingDone ? <><button icon="list-numbered" size="small" onPress={() => showLeaderboardBlock()}>Leaderboard</button><spacer size="small" /></>:""}
            
            {userGameStatus.state == gameStates.Started? <><button icon="show" size="small" onPress={() => {
              const dBlocks:displayBlocks = UIdisplayBlocks;
              dBlocks.confirmShowSpot = true;
              setUIdisplayBlocks(dBlocks);
            }}></button><spacer size="small" /></>: ""}
            
            {userGameStatus.state == gameStates.Started? <><button icon={ (UIdisplayBlocks.zoomView || UIdisplayBlocks.zoomSelect ) ? "search-fill" :  "search" } size="small" onPress={() => toggleZoomSelect()} appearance={ (UIdisplayBlocks.zoomView || UIdisplayBlocks.zoomSelect ) ? "success" :  "secondary" } ></button><spacer size="small" /></> : ""}

            { (authorName == currentUsername || userGameStatus.state == gameStates.Aborted || userGameStatus.state == gameStates.Finished ) && validTileSpotsMarkingDone ? <><button icon="show" size="small" width="140px" onPress={() => toggleSpots()}> { UIdisplayBlocks.spots ? "Hide spots":"Show spots"} </button><spacer size="small" /></> : "" }
            
            {authorName == currentUsername && !validTileSpotsMarkingDone? <><button size="small" onPress={ ()=> finishMarkingSpots() }> Done marking!</button></>:""}
            <StatusBlock />
          </hstack>
        </blocks>
      )
    } else {
        return (
        <blocks height="tall">
        <hstack gap="small" width="100%" height="100%" alignment="middle center" borderColor="transparent" border="none" >
          <text wrap width="80%" style="heading">This post has expired. Posts from Spottit app expires after 20 days(Due to current Reddit Developer Platform limitations).</text>
        </hstack>
        </blocks>);   
    }
  }
})

export default Devvit

const pictureInputForm = Devvit.createForm(  (data) => {
  return {
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
        helpText: "Select flair for your post. This must be selected if this subreddit requires flair for posts.",
        required: false,
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
    const subreddit = await context.reddit.getCurrentSubreddit();
    const flairTemplates = await subreddit.getPostFlairTemplates();
    // Create an array of options for the dropdown
    const options = flairTemplates.map(template => {
      return { label: template.text, value: template.id };
    });
    
    context.ui.showForm(pictureInputForm, {flairOptions: options});
  },
});
