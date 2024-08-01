import {Devvit} from '@devvit/public-api'
Devvit.configure({redditAPI: true, redis: true });

const resolutionx = 22;
const resolutiony = 40;
const size = 16;
const tiles = new Array(resolutionx * resolutiony).fill(0);
const redisExpireTimeSeconds = 1728000;//20 days in seconds.

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
    const [attemptsCount, setAttemptsCount] = useState(0);
    const [showSpots, setShowSpots] = !validTileSpotsMarkingDone? useState(1):useState(0);
    const [showGameStartBlock, setShowGameStartBlock] = useState(1);
    const [gameStartTime, setGameStartTime]=useState(0);
    const [counter, setCounter] = useState(0);
    const [showLeaderBoard, setShowLeaderBoard] = useState(0);
    const [leaderBoardRec, setLeaderBoardRec] = useState(async () => {//Get Leaderboard records.
      
      const previousLeaderBoard = await redis.hgetall(myPostId);
      if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
        var leaderBoardRecords: leaderBoard[] = [];
        for (const key in previousLeaderBoard) {
          const redisLBObj = JSON.parse(previousLeaderBoard[key]);
          if( redisLBObj.username ) {
            const lbObj:leaderBoard = {username: redisLBObj.username, timeInSeconds:redisLBObj.timeInSeconds };
            console.log("Pushing object from fetched from redis:");
            console.log(lbObj)
            leaderBoardRecords.push(lbObj);
          }
        }

        leaderBoardRecords.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
        return leaderBoardRecords;
      } 
      return [];
    });

    const incrementCounter = () => {
      if( gameStarted) {
        var timeNow = new Date().getTime();
        var totalTime = Math.floor ( (timeNow - gameStartTime) / 1000 ) ;
        setCounter(totalTime);
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
        setAttemptsCount( attemptsCount + 1);
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
    
    const PictureTiles = () => (!validTileSpotsMarkingDone || gameStarted) && (
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
            <text style="heading" size="medium" weight="bold" color="black" width="70%">
              &nbsp;Username
            </text>
            <text style="heading" size="medium" color="black" width="30%" alignment="start">
              Total Time
            </text>
          </hstack>
          <vstack width="100%" padding="small" height="70%">
            {leaderBoardRec.map((row) => (
            <LeaderBoardRow  username={row.username} timeInSeconds={row.timeInSeconds} />
            ))}
          </vstack>
          <hstack alignment="bottom center" width="100%" height="10%">
            <button size="small" icon='close' onPress={() => hideLeaderboardBlock()}>Close</button>
          </hstack>
          <spacer size="small" />
        </vstack>
      </vstack>
    );

    const LeaderBoardRow = (row: leaderBoard): JSX.Element => {
      return (<hstack padding="xsmall">
        <text style="body" size="small" weight="bold" color="black" onPress={() => openUserPage(row.username)} width="70%">
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
      console.log("Here comes the leaderboard records:");
      console.log(leaderBoardRec);
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

    function startGame(){
      setGameStarted(true);
      setGameStartTime(new Date().getTime());
      
      setShowSpots(0);
      setShowGameStartBlock(0)
    }
  
    const InfoBlock = () => showHelp == 0  && ScreenIsWide && (     
    <vstack width="344px" height={'100%'} alignment="start middle" backgroundColor='white'>
      <hstack>
        <hstack height="100%" backgroundColor='white' alignment="start middle">
          <icon name="left-fill" size="large"></icon> 
          <icon name="left-fill" size="large"></icon>
          <spacer size="small"></spacer>
        </hstack>
        <hstack width="300px" backgroundColor='white' >
          <text width="300px" size="xlarge" weight="bold" wrap color="black">
            Find the spot in this picture!
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
              Please mark all tiles by clicking on the boxes. If the object corners run into other boxes, include those boxes too.
              Wait a bit after each click for the box to fill with dark colour (there could be a little delay).
              Zoom is presently not supported, so you can click on the External icon below to the open full image, or you can use browser zoom features if you are using browser.
            </text>
            <spacer size="small"></spacer>
            <text width="300px" size="small" style='body' weight="regular" wrap color="black">
              Click below button after marking all the spots. Afer you click this, members can see the post and start spotting!
            </text>
            <spacer size="small"></spacer>
            <button size="small" onPress={async ()=> { setValidTileSpotsMarkingDone(true); await redis.set(myPostId+'ValidTileSpotsMarkingDone', 'true');}}> Done marking all the spots!</button>
          </vstack>
        </hstack>
      </vstack>
      );

    const GameStartBlock = () => showGameStartBlock == 1 && validTileSpotsMarkingDone && (
    <vstack width="344px" height="100%" alignment="center middle" backgroundColor='rgba(28, 29, 28, 0.70)'>
      <text width="300px" size="large" weight="bold" wrap color="white" alignment='middle center' >Click start when you're ready to find the spot!</text>
      <spacer size="small"/>
      <button appearance="success" onPress={()=> startGame()} >Start!</button>
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
                Click/tap the spot when you find it.
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
    </zstack>
  );

  const StatusBlock = () => gameStarted && (
  <hstack alignment="top end" backgroundColor='white'>
    <text style="body" color='black' size='small' width="250px">
        Total attempts: {attemptsCount} &nbsp; Total time: {counter}
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
          <button icon="external" size="small" onPress={() => showFullPicture()}></button><spacer size="small" />
          {authorName == currentUsername? <button icon="tap" size="small" width="140px" onPress={() => toggleSpotsEditing()}> {showSpots == 0 ? "Show spots": "Hide spots"} </button> : "" } <spacer size="small" />
          <button icon="list-numbered" size="small" onPress={() => showLeaderboardBlock()}>Leaderboard</button><spacer size="small" />
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
