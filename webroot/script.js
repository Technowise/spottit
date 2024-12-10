<script>
  const zoomist = new Zoomist('.zoomist-container', {
    maxScale: 4
  });

const zoomistContainer = document.getElementById("zoomist-image");

function loadImage() {
   if ( zoomistContainer.childElementCount == 0 ){
        window.parent.postMessage({
        type: 'requestImage'
        }, '*');
    }
}

loadInitialData();


window.onmessage = (ev) => {
  console.log("Got message now...");

  var type = ev.data.data.message.type;
  
  if (type  == "image") {
      var url = ev.data.data.message.url;
      console.log("Got a new image...")
      console.log(url);
      const image = document.createElement("image");
      image.src = url;
      zoomistContainer.appendChild(image);
  }

}


</script>