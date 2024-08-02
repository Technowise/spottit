import {Devvit} from '@devvit/public-api'
Devvit.configure({redditAPI: true, redis: true });

const resolutionx = 22;
const resolutiony = 40;
const size = 16;
const tiles = new Array(resolutionx * resolutiony).fill(0);
const redisExpireTimeSeconds = 1728000;//20 days in seconds.
const maxWrongAttempts = 5;

type leaderBoard = {
  username: string;
  timeInSeconds: number;
};

type pictureTile = {
  position: number;
}

Devvit.addTrigger({
  event: 'PostDelete',
  onEvent: async (event, context) => {//Delete all keys associated with post.
    const {redis} = context;
    console.log(`Received PostDelete event:\n${JSON.stringify(event)}`);
    await redis.hdel(event.postId, await redis.hkeys(event.postId));  
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
    const [data] = useState(tiles);
    const [currentUsername] = useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      return currentUser?.username;
    });

    const [showHelp, setShowHelp] = useState(0);
    const [showPicture, setShowPicture] = useState(1);
    const [validTileSpotsMarkingDone, setValidTileSpotsMarkingDone] = useState(async () => {
      const ValidTileSpotsMarkingDone = await redis.get(myPostId+'ValidTileSpotsMarkingDone');
      if( ValidTileSpotsMarkingDone &&  ValidTileSpotsMarkingDone == 'true') {
        return true;
      }
      return false;
    });
    const [gameStarted, setGameStarted] = useState(false);

    const [showSpots, setShowSpots] = !validTileSpotsMarkingDone? useState(1):useState(0);
    const [gameStartTime, setGameStartTime]=useState(0);
    const [counter, setCounter] = useState(0);
    const [counterTracker, setCounterTracker] = useState( async() =>{
      var counterValue = await redis.get(myPostId+currentUsername+'CounterTracker');
      if (counterValue && counterValue.length > 0 ) {
        var counterIntValue = parseInt(counterValue);
        setCounter(counterIntValue);
        return counterIntValue;
      }
      return 0;
    } );
    const [showLeaderBoard, setShowLeaderBoard] = useState(0);
    const [userTimeInSeconds, setUserTimeInSeconds] = useState(0);
    

    const [userHasPlayedGame, setUserHasPlayedGame] = useState(false);
    const [leaderBoardRec, setLeaderBoardRec] = useState(async () => {//Get Leaderboard records.
      const previousLeaderBoard = await redis.hgetall(myPostId);
      if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
        var leaderBoardRecords: leaderBoard[] = [];
        for (const key in previousLeaderBoard) {
          const redisLBObj = JSON.parse(previousLeaderBoard[key]);
          if( redisLBObj.username ) {
            if(redisLBObj.username == currentUsername) {
              setUserHasPlayedGame(true);
              setUserTimeInSeconds(redisLBObj.timeInSeconds);
            }
            const lbObj:leaderBoard = {username: redisLBObj.username, timeInSeconds:redisLBObj.timeInSeconds };
            leaderBoardRecords.push(lbObj);
          }
        }
        leaderBoardRecords.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
        return leaderBoardRecords;
      } 
      return [];
    });

    const [attemptsCount, setAttemptsCount] = useState(async() =>{
      var countValue = await redis.get(myPostId+currentUsername+'AttemptsCount');
      if (countValue && countValue.length > 0 ) {
        var countIntValue = parseInt(countValue);
        return countIntValue;
      }
      return 0;
    } );

    const incrementCounter = async () => {
      if( gameStarted) {
        var timeNow = new Date().getTime();
        var totalTime = Math.floor ( (timeNow - gameStartTime) / 1000 ) ;
        setCounter(totalTime);
        if(counter - counterTracker > 5 ) {//Every 5 seconds, put the counter to redis for tracking.
          setCounterTracker(counter);
          await redis.set(myPostId+currentUsername+'CounterTracker', counter.toString());
          await redis.expire(myPostId+currentUsername+'CounterTracker', redisExpireTimeSeconds);
        }
      }
    }

    context.useInterval(incrementCounter, 1000).start();

    const [validTileSpots, setValidTileSpots] = useState(async () => {//Get array of valid picture tile spots from redis.
      var prevValidTiles: pictureTile[] = [];
      const validSpotsFromRedis = await redis.hget(myPostId, 'validSpots');
      if (validSpotsFromRedis) {
          const validTileObjectsFromRedis = JSON.parse(validSpotsFromRedis);
          for(var i = 0; i < validTileObjectsFromRedis.length; i++) {
            prevValidTiles.push({position: validTileObjectsFromRedis[i].position})
          }
        return prevValidTiles;
      } 
      return [];
    });

    const [imageURL] = useState(async () => {
      const imageURL = await redis.get(myPostId+'imageURL');
      if (imageURL) {
          return imageURL;
      }
      return "";
    });

    const [authorName] = useState(async () => {
      const authorName = await redis.get(myPostId+'authorName');
      if (authorName) {
          return authorName;
      }
      return "";
    });

    const openUserPage = async (username: string) => {
      context.ui.navigateTo(`https://www.reddit.com/user/${username}/`);
    };

    function showFullPicture() {
      context.ui.navigateTo(imageURL);
    }

    async function toggleValidTile(context:Devvit.Context, index=0) {
      if( isValidSpot(index)) {
        const newValidTileSpots = validTileSpots.filter(i => i.position != index );
        setValidTileSpots(newValidTileSpots);
        await redis.hset(myPostId, { ["validSpots"]: JSON.stringify(newValidTileSpots) });
        await redis.expire(myPostId, redisExpireTimeSeconds);
      }
      else {
        const newValidTileSpots = validTileSpots;
        newValidTileSpots.push({
          position: index
        });
        setValidTileSpots(newValidTileSpots);
        await redis.hset(myPostId, { ["validSpots"]: JSON.stringify(newValidTileSpots) });
        await redis.expire(myPostId, redisExpireTimeSeconds);
      }
    }

    async function checkIfTileIsValid(context:Devvit.Context, index:number) {
      if( isValidSpot(index)) {
        context.ui.showToast({
          text: "You have successfully found the spot in "+counter+" seconds, Congratulations!",
          appearance: 'success',
        });
        setGameStarted(false);
        setUserHasPlayedGame(true);
        setUserTimeInSeconds(counter);

        const username = currentUsername?? 'defaultUsername';
        const leaderBoardArray = leaderBoardRec;
        const  leaderBoardObj:leaderBoard  = { username:username, timeInSeconds: counter };
        leaderBoardArray.push(leaderBoardObj);

        leaderBoardArray.sort((a, b) => a.timeInSeconds - b.timeInSeconds);

        setLeaderBoardRec(leaderBoardArray);
        await redis.hset(myPostId, { [username]: JSON.stringify(leaderBoardObj) });
        await redis.expire(myPostId, redisExpireTimeSeconds);
      }
      else {
        context.ui.showToast({
          text: "Sorry, that is not the right spot!",
          appearance: 'neutral',
        });
        if (attemptsCount < maxWrongAttempts ) {
          redis.set(myPostId+currentUsername+'AttemptsCount', (attemptsCount + 1).toString());
          setAttemptsCount( attemptsCount + 1);
          await redis.expire(myPostId+currentUsername+'AttemptsCount', redisExpireTimeSeconds);
        }
        else{
          setGameStarted(false);
        }
      }
    }

    function isValidSpot(position:number) {
      let spotObj = validTileSpots.find(i => i.position === position );
      if( spotObj ) {
        return true;
      }
      else {
        return false;
      }
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
    
    const PictureTiles = () => ( (authorName == currentUsername) || gameStarted ) && (
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
          } else {
            checkIfTileIsValid(context, index);
          }
        }}
        width = {`${size}px`}
        height = {`${size}px`}
        backgroundColor={ showSpots == 1 && isValidSpot(index) ? 'rgba(28, 29, 28, 0.70)' : 'transparent'}   border={showSpots == 1 && !validTileSpotsMarkingDone? "thin":"none"} borderColor='rgba(28, 29, 28, 0.70)'
      >
      </hstack>
    ));  

    const LeaderBoardBlock = () => showLeaderBoard == 1 && (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="96%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="275px" color='black'>
                &nbsp;&nbsp;&nbsp;&nbsp;Leaderboard
            </text>
            <button size="small" icon='close' width="34px" onPress={() => hideLeaderboardBlock()}></button>
          </hstack>
          <hstack padding="small" width="100%" backgroundColor="#c0c0c0" height="8%">
            <text style="heading" size="small" weight="bold" color="black" width="15%">
             Rank
            </text>
            <text style="heading" size="small" weight="bold" color="black" width="55%">
             Username
            </text>
            <text style="heading" size="small" color="black" width="30%" alignment="start">
              Total Time
            </text>
          </hstack>
          <vstack width="100%" padding="small" height="70%">
            {leaderBoardRec.map((row, index) => ( 
            <LeaderBoardRow row={row} index={index + 1} />
            ))}
          </vstack>
          <hstack alignment="bottom center" width="100%" height="10%">
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
        <text style="body" size="small" weight="bold" color="black" onPress={() => openUserPage(row.username)} width="55%">
          {row.username}
        </text>
        <text style="body" size="small" color="black" width="30%" alignment="start">
          &nbsp;{row.timeInSeconds}
        </text>
        </hstack>
      );
    };

    function toggleSpotsEditing() {
      if( showSpots == 1 ) {
        setShowSpots(0);
      }
      else {
        setShowSpots(1);
      }
    }

    function showHelpBlock() {
      if( ! ScreenIsWide ) { //Hide picture in small screen to make space.
        setShowPicture(0);
      }
      setShowHelp(1)
    }
    
    function showLeaderboardBlock() {
      setShowPicture(0);
      setShowLeaderBoard(1);
    }

    function hideLeaderboardBlock() {
      setShowPicture(1);
      setShowLeaderBoard(0);
    }

    function hideHelpBlock() {
      if( ! ScreenIsWide ) { //Hide picture in small screen to make space.
        setShowPicture(1);
      }
      setShowHelp(0);
    }

    function startOrResumeGame(){
      setGameStarted(true);
      setGameStartTime(new Date().getTime() -  (counterTracker * 1000 ));
      setShowSpots(0);
    }
  
    const InfoBlock = () => showSpots == 0 && authorName == currentUsername && validTileSpotsMarkingDone && (     
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

    const MarkSpotsInfo = () => !validTileSpotsMarkingDone && authorName == currentUsername && ScreenIsWide && (     
      <vstack width="344px" height={'100%'} alignment="start middle" backgroundColor='white'>
        <hstack>
          <hstack height="100%" backgroundColor='white' alignment="start middle">
            <icon name="left-fill" size="large"></icon> 
            <spacer size="small"></spacer>
          </hstack>
          <vstack width="300px" backgroundColor='white' alignment="center middle">
            <text width="300px" size="large" weight="bold" wrap color="black">
              Mark all the tiles/spots that includes what the participants must find.
            </text>
            <spacer size="small"></spacer>
            <text width="300px" size="small" style='body' weight="regular" wrap color="black">
              Please mark tiles by clicking on the respective boxes. If the object corners run into other boxes, include those boxes too.
              Use browser zoom features to zoom in and out while marking.
              Wait a bit after each click for the box to fill with dark colour (there could be a little delay).
              You can click on the External icon below to the open full image view.
            </text>
            <spacer size="small"></spacer>
            <text width="300px" size="small" style='body' weight="regular" wrap color="black">
              Click below button after marking all the spots. Afer you click this, members can see the post and start spotting!
            </text>
            <spacer size="small"></spacer>
            <button size="small" onPress={async ()=> { setValidTileSpotsMarkingDone(true); await redis.set(myPostId+'ValidTileSpotsMarkingDone', 'true'); setShowSpots(0);}}> Done marking all the spots!</button>
          </vstack>
        </hstack>
      </vstack>
      );

    const GameStartBlock = () =>  authorName != currentUsername &&  !userHasPlayedGame && validTileSpotsMarkingDone &&  !gameStarted && attemptsCount < maxWrongAttempts  && (
    <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
      <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Click '{ counterTracker == 0 ? "Start!": "Resume!"}' when you're ready to find the spot!</text>
      <spacer size="small"/>
      <button appearance="success" onPress={()=> startOrResumeGame()} > { counterTracker == 0 ? "Start!": "Resume!"}  </button>
    </vstack>
    );
  
    const GameFinishedBlock = () => authorName != currentUsername && userHasPlayedGame && (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >You have found the spot in {userTimeInSeconds} seconds! Click on Leaderboard button to see time of others. </text>
      </vstack>
    );

    const MaxAttemptsReachedBlock = () => attemptsCount >= maxWrongAttempts && (
      <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
        <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Sorry, you have used up all {maxWrongAttempts} attempts to find the spot and unfortunately the spot is still not found!</text>
      </vstack>
    );

    const HelpBlock = () => showHelp == 1 && (
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
                Search the picture to find thing/object as per post title and click/tap the spot when you spot it. You can use browser zoom features to look at parts of the picture, or click on external icon below to view full picture.
                Once you find the thing/object, come back to this view and click on the spot.
          </text>
          <spacer size="medium" />
          <hstack alignment='start middle'>
            <icon name="external" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; View full picture.
            </text>
          </hstack>
          <hstack>
            <text style="body" wrap size="medium" color='black'>
              Click on&nbsp;
            </text>
            <icon name="external" size='small' color='black'></icon>
            <text style="body" wrap size="medium" color='black'>
              &nbsp;icon to view full picture(source).
            </text>
          </hstack>
          <spacer size="medium" />
          <hstack alignment='start middle'>
            <icon name="list-numbered" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; View leaderboard
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
                Click on Leaderboard button below to view time taken by other participants.
          </text>     
        </vstack>

        <hstack alignment="bottom center" width="100%" height="8%">
          <button size="small" icon='close' onPress={() => hideHelpBlock()}>Close</button>
        </hstack>
      </vstack>
  );

  const PictureBlock = () => showPicture == 1 && (
    <zstack alignment="top start" width="344px" height="100%" cornerRadius="small" border="none">
      <hstack width="344px" height="100%" alignment="top start" backgroundColor='transparent'>
        <image
          width="100%"
          height="100%"
          url= {imageURL}
          description="cat"
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
    </zstack>
  );

  const StatusBlock = () => gameStarted && (
  <hstack alignment="top end">
    <text style="body" size='medium' weight="bold">
        Attempts: {attemptsCount} &nbsp; Time: {counter}
    </text>
  </hstack> );

    return (
      <blocks height="tall">
        <hstack gap="small" width="100%" height="90%" alignment="middle center" borderColor="transparent" border="none" >
          <PictureBlock />
          <HelpBlock />
          <MarkSpotsInfo />
          <LeaderBoardBlock />
          
        </hstack>
        <hstack alignment="middle center" width="100%" height="10%">
          <button icon="help" size="small" onPress={() => showHelpBlock()}>Help</button><spacer size="small" />
          {gameStarted? <button icon="external" size="small" onPress={() => showFullPicture()}></button> : <button icon="list-numbered" size="small" onPress={() => showLeaderboardBlock()}>Leaderboard</button>}
          <spacer size="small" />
          {authorName == currentUsername? <button icon="tap" size="small" width="140px" onPress={() => toggleSpotsEditing()}> {showSpots == 0 ? "Show spots": "Hide spots"} </button> : "" } <spacer size="small" />
          <StatusBlock />
        </hstack>
      </blocks>
    )
  }
})

export default Devvit

const pictureInputForm = Devvit.createForm(  
  {  
    fields: [
      {
        type: 'string',  
        name: 'title',  
        label: 'Post title',
        required: true,
        helpText: "Enter a title for what to spot in the picuture"
      },
      {  
        type: 'image',
        name: 'postImage',
        label: 'Select a picture for your post',
        required: true,
        helpText: "Select a picture for your post",
      },
    ],  
  },  
  async (event, context) => {// onSubmit handler
    const ui  = context.ui;
    const reddit = context.reddit;
    const subreddit = await reddit.getCurrentSubreddit();
    const postImage = event.values.postImage;
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
    });
  
    const {redis} = context;
    const myPostId = post.id;
    const currentUsr = await context.reddit.getCurrentUser();
    const currentUsrName = currentUsr?.username ?? "";
    await redis.set(myPostId+'imageURL', postImage);
    await redis.expire(myPostId+'imageURL', redisExpireTimeSeconds);
    await redis.set(myPostId+'authorName', currentUsrName );
    await redis.expire(myPostId+'authorName', redisExpireTimeSeconds);
    await redis.set(myPostId+'ValidTileSpotsMarkingDone', 'false');
    await redis.expire(myPostId+'ValidTileSpotsMarkingDone', redisExpireTimeSeconds);
  
    ui.showToast({
      text: `Successfully created a Spottit post!`,
      appearance: 'success',
    });
    context.ui.navigateTo(post.url);
  }  
);

Devvit.addMenuItem({
  label: 'Create Spottit post',
  location: 'subreddit',
  onPress: async (_, context) => {
    context. ui.showForm(pictureInputForm);
  },
});
