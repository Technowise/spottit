# Spottit
This is a game of spotting things in a picture. The app adds ability to create picture posts where post creator can mark specific spots in the picture and then ask other users to find that spot. This game is inspired by /r/FindTheSniper subreddit. Each participant's time taken to find the spot is measured and shown in leaderboard ranked on total time taken. Those who wish to view the solution/spot can click on the eye icon - this will also abort the game for that participant. This is an app developed using Reddit app Developer Platform.

![Desktop Modal View](https://i.imgur.com/NnfUEgE.png) ![Desktop Extended View](https://i.imgur.com/P8ghNpy.jpeg)  ![Mobile App Full Screen View](https://i.imgur.com/WTW5RJ4.jpeg) 

### Install the app:
Moderators can install the app to their subreddit by going to [https://developers.reddit.com/apps/spottit-game](https://developers.reddit.com/apps/spottit-game)

### Creating a new post:
1) After installing the app to your subreddit, go to your subreddit's [three-dot-menu (...)](https://developers.reddit.com/docs/capabilities/menu-actions), and select "Create a Spottit post".
2) You will be presented with a form to provide a title, image/picture to upload and option to choose flair for the post. It would be ideal upload portrait images than landscape for better user experience.
3) After you submit the form, you will be redirected to the post, where you will have to mark all the tiles that contain what they need to spot. After selecting all the tiles, click on 'Done marking'. After this, the post will be ready for others to play.

### Playing the game
You can click on "Start!" button to start the game. This will show the picture, along with toolbar buttons to zoom into the picture. You can pinch-and-zoom, or pan to specific areas of the picture to find the spot. After you find the spot, double-click/double-tap on the spot to register. If you wish to view the solution/spot, you can click on the eye icon - this will hightlight the spot (solution) and abort the game.

## Features:
#### Zoom and pan tools
The app adds tool to zoom/pan the image as needed to search and find the respective spot.

#### Leaderbaord
Leaderboard contains the list of usernames ordered by number of words they have solved.

#### Help page
Help page describes details on how to play the game and the app's features.

## Changelog
* 0.0.12
  * Enhanced the app experience using Webview feature of devvit - added tool to zoom/pan image.
* 0.0.15
  * Making use of web-view that allows pinch and zoom, updated the devvit version to 0.11.6.
* 0.0.19
  * Migrated to new web-view which allows to go full screen on mobile app, and wide modal view in desktop.
* 0.0.21
  * Post archival comment made to be added/updated after every new entry to leaderboard.
* 0.0.23
  * Add feature to be able to mark and find multiple-spots in the same picture.
* 0.0.25
  * Limit number of leaderboard entries in post archive comment(due to limitation in comment size).
  * Add comment to post on successful spotting by user.
* 0.0.26
  * Make comment on successful spotting configurable, along with time duration setting.
* 0.0.27
  * Update devvit version(to 0.11.11), unmount web-view after game is finished, changes to fix possibility of negative time in leaderboard.
* 0.0.28
  * Bug fix: Fix issue with if/else statement while fetching the user game status.
* 0.0.29
  * Bug fix 1: Addressed issue with wrongfully registering double-tap(spotting) when users are dragging/moving the image or zooming the image.
  * Bug fix 2: Addressed issue with wrongfully showing 'Resume' option (on refreshing the post) after user has aborted the game.
  * Enhancement: Provide a way to return to expanded web-view after the game is finished or aborted by clicking on 'View' button.
  * Library update: Updated zoomist library to latest available version.
* 0.0.30
  * Bug fix: Android users were not able to click on spot to register, so made a small fix to address it.
* 0.0.31
  * Enhancement: Added 'Join' button for users to subscribe to the subreddit after playing the game.
* 0.0.32
  * Enhancement: Added 'I give up!' Button to abort game, added 'Join' button for users to subscribe to the subreddit in game Resume and Aborted views.
* 0.0.33
  * Bug fix: Fixed logic for showing 'Join button in the Resume game view.
* 0.0.34
  * Bug fix: Flair selected was not getting applied to post through submitPost call. It is addressed now by using setPostFlair after the submitPost call.
* 0.0.35
  * Enhancement: Show percentile of the user among the leaderboard in toast message after finishing the game.
* 0.0.39
  * Bug fixes: 
    1) Fix issue with showing the spot by default for users who have aborted.
    2) Fix issue with percentile calculcation for leaderboard.
* 0.0.40
  * Improvements:
    1) Update to devvit public-api version 0.11.18
    2) Add confirmation dialog for deletion of entries from Leaderboard.
    3) Enable moderators of the sub to delete entries from leaderboard.

## Links
### Demo
You can try out this game by going here: [Spottit game community](https://www.reddit.com/r/Spottit/)
