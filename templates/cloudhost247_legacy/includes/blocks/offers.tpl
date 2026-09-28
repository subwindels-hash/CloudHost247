{if $hostx_blocks[$block_slug]}
<div class="offers-banner">
   <div class="container">
      <div class="row">
         <div class="col-sm-12">
            <div class="offers-banner-inner">
               <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
               <h5>{eval var=$hostx_blocks[$block_slug]->sub_title}</h5>
                   {eval var=$hostx_blocks[$block_slug]->description}
            </div>
         </div>
      </div>
   </div>
</div>

<script>
   var x = setInterval( function(){ t(); } , 1000);
   var date_ = "{$hostx_theme_settings.offer_timer}";
   function t() {
     var now = new Date().getTime();
     var countDownDate = new Date(date_).getTime();
     var distance = countDownDate - now;

     var days = Math.floor(distance / (1000 * 60 * 60 * 24));
     var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
     var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
     var seconds = Math.floor((distance % (1000 * 60)) / 1000);

     if (distance > 0) {

        document.getElementById("offer-Days").innerHTML = days.toString().length < 2 ? "0"+days : days  ;
        document.getElementById("offer-Hours").innerHTML =  hours.toString().length < 2 ? "0"+hours : hours  ;
        document.getElementById("offer-Minutes").innerHTML =  minutes.toString().length < 2 ? "0"+minutes : minutes;
        document.getElementById("offer-Seconds").innerHTML =  seconds.toString().length < 2 ? "0"+seconds : seconds;
     }else{
       clearInterval(x);
     }
     
   }

</script>

{/if}