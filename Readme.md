
# leader-angellist

  A [leader](https://github.com/ivolo/leader) plugin for the [Angellist](https://angellist.com/) API. Get an AngelList API key [here](https://angel.co/api).

## Example

```js
var Leader = require('leader');
var angelList = require('leader-angellist');

var leader = Leader()
  .use(angelList({
    clientId: 'xxxx',
    token: 'xxx'
  }))
  .populate({ email: 'ted.j.tomlinson@gmail.com'}, function(err, person) {
    // ..
});
```
