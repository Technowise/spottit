/*
  const zoomist = new Zoomist('.zoomist-container', {
    maxScale: 4
  });
*/
const zoomistImageContainer = document.getElementById("zoomist-image");

function loadImage() {
   if ( zoomistImageContainer.childElementCount == 0 ){
        window.parent.postMessage({
        type: 'requestImage'
        }, '*');
    }
}

loadImage();


window.onmessage = (ev) => {
  console.log("Got message now...");

  var type = ev.data.data.message.type;
  
  if (type  == "image") {
      var url = ev.data.data.message.url;
      console.log("Got a new image...")
      console.log(url);
      const image = document.createElement("img");
      image.src = url;
      zoomistImageContainer.appendChild(image);

      const zoomist = new Zoomist('.zoomist-container', {
        maxScale: 4,
        /*initScale: 2, */
        slider: true, 
        zoomer: true
      });
  }

}
