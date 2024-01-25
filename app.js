const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();

app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const startDB = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

startDB();

const authenticate = (request, response, next) => {
  let jwtToken;
  const { authorization } = request.headers;
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }

  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "SECRET", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.user = payload;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

const getFollowingArray = (following) => {
  let resArray = [];
  following.map((following) => {
    resArray.push(following.user_id);
  });
  return resArray;
};

const isFollowing = async (tweetId, userId) => {
  const getFollowing = `
  SELECT user.user_id
  FROM (follower INNER JOIN user ON follower.follower_user_id = user.user_id)
  WHERE follower.following_user_id = ${userId};`;
  const following = await db.all(getFollowing);
  const followingArray = getFollowingArray(following);

  const getTweetUser = `
  SELECT user_id
  FROM tweet
  WHERE tweet_id = ${tweetId};`;
  const tweetUser = await db.get(getTweetUser);
  const tweetUserId = tweetUser.user_id;

  return followingArray.includes(tweetUserId);
};

const getUserId = async (userName) => {
  const getUserId = `
  SELECT user_id
  FROM user
  WHERE username = "${userName}";`;
  const userIdObj = await db.get(getUserId);
  const userId = userIdObj.user_id;
  return userId;
};

const getTweetDetails = async (tweetId) => {
  const getTweetReplies = `
    SELECT tweet.tweet, COUNT(reply.reply_id) AS replies, tweet.date_time AS dateTime
    FROM (tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id)
    WHERE tweet.tweet_id = ${tweetId};`;
  const tweetDetails = await db.get(getTweetReplies);

  const getTweetLikes = `
    SELECT COUNT(like.like_id) AS likes
    FROM (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id)
    WHERE tweet.tweet_id = ${tweetId};`;
  const tweetLikes = await db.get(getTweetLikes);

  const resTweetDetails = {};
  resTweetDetails.tweet = tweetDetails.tweet;
  resTweetDetails.likes = tweetLikes.likes;
  resTweetDetails.replies = tweetDetails.replies;
  resTweetDetails.dateTime = tweetDetails.dateTime;

  return resTweetDetails;
};

const getTweetsArray = async (tweetIdsArray) => {
  let resArray = [];
  for (let tweet of tweetIdsArray) {
    const resTweet = await getTweetDetails(tweet);
    resArray.push(resTweet);
  }
  return resArray;
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const userDetails = `
    SELECT *
    FROM user
    WHERE username = "${username}";`;
  const user = await db.get(userDetails);

  if (user !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const writeUser = `
        INSERT INTO user(username, password, name, gender)
        VALUES ("${username}", "${hashedPassword}", "${name}", "${gender}");`;
    await db.run(writeUser);
    response.send("User created successfully");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserDetails = `
    SELECT *
    FROM user
    WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);

  if (userDetails !== undefined) {
    if (await bcrypt.compare(password, userDetails.password)) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "SECRET");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

app.get("/user/tweets/feed/", authenticate, async (request, response) => {
  const userName = request.user.username;
  const userId = await getUserId(userName);

  const getFollowing = `
  SELECT following_user_id
  FROM follower
  WHERE follower_user_id = ${userId};`;
  const following = await db.all(getFollowing);
  let followingArray = [];
  following.map((followingObj) => {
    followingArray.push(followingObj.following_user_id);
  });

  let resStr = "";
  let construct = followingArray.map((userId) => {
    resStr = resStr + "user.user_id = " + userId + " OR ";
  });

  let str = resStr.slice(0, resStr.length - 4);

  const getFeed = `
  SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
  FROM (tweet INNER JOIN user ON tweet.user_id = user.user_id)
  WHERE ${str}
  ORDER BY date_time DESC
  LIMIT 4`;

  const tweets = await db.all(getFeed);
  response.send(tweets);
});

app.get("/user/following/", authenticate, async (request, response) => {
  const userName = request.user.username;
  const userId = await getUserId(userName);

  const getFollowing = `
  SELECT name
  FROM (follower INNER JOIN user ON follower.following_user_id = user.user_id)
  WHERE follower.follower_user_id = ${userId};`;
  const following = await db.all(getFollowing);
  response.send(following);
});

app.get("/user/followers/", authenticate, async (request, response) => {
  const userName = request.user.username;
  const userId = await getUserId(userName);

  const getFollowers = `
  SELECT name
  FROM (follower INNER JOIN user ON follower.follower_user_id = user.user_id)
  WHERE follower.following_user_id = ${userId};`;
  const followers = await db.all(getFollowers);
  response.send(followers);
});

app.get("/tweets/:tweetId/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const userName = request.user.username;
  const userId = await getUserId(userName);

  const isValid = await isFollowing(tweetId, userId);

  if (isValid) {
    const resTweetDetails = await getTweetDetails(tweetId);

    response.send(resTweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get("/tweets/:tweetId/likes/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const userName = request.user.username;
  const userId = await getUserId(userName);

  const isValid = await isFollowing(tweetId, userId);

  if (isValid) {
    const getLikedUsers = `
    SELECT username
    FROM (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) AS T
    INNER JOIN user ON like.user_id = user.user_id
    WHERE tweet.tweet_id = ${tweetId};`;
    const likedUsers = await db.all(getLikedUsers);

    const resArray = [];
    likedUsers.map((obj) => {
      resArray.push(obj.username);
    });
    const resObj = { likes: resArray };
    response.send(resObj);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/replies/",
  authenticate,
  async (request, response) => {
    const { tweetId } = request.params;
    const userName = request.user.username;
    const userId = await getUserId(userName);

    const isValid = await isFollowing(tweetId, userId);

    if (isValid) {
      const getTweetReplies = `
    SELECT user.name, reply.reply
    FROM (tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id) AS T
    INNER JOIN user ON reply.user_id = user.user_id
    WHERE tweet.tweet_id = ${tweetId};`;
      const tweetReplies = await db.all(getTweetReplies);
      const replyObj = { replies: tweetReplies };
      response.send(replyObj);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticate, async (request, response) => {
  const userName = request.user.username;
  const userId = await getUserId(userName);

  const getTweetIds = `
  SELECT tweet.tweet_id
  FROM (user INNER JOIN tweet ON user.user_id = tweet.user_id)
  WHERE user.user_id = ${userId};`;

  const tweetIds = await db.all(getTweetIds);

  const tweetIdsArray = [];

  tweetIds.map((tweetId) => {
    tweetIdsArray.push(tweetId.tweet_id);
  });

  const tweets = await getTweetsArray(tweetIdsArray);
  response.send(tweets);
});

app.post("/user/tweets/", authenticate, async (request, response) => {
  const userName = request.user.username;
  const userId = await getUserId(userName);
  const { tweet } = request.body;

  const writeTweet = `
  INSERT INTO tweet(tweet, user_id)
  VALUES("${tweet}", ${userId});`;
  await db.run(writeTweet);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const userName = request.user.username;
  const userId1 = await getUserId(userName);
  const getUserId2 = `
  SELECT user_id
  FROM tweet
  WHERE tweet_id = ${tweetId};`;
  const userId2Obj = await db.get(getUserId2);

  const userId2 = userId2Obj.user_id;

  if (userId1 === userId2) {
    const deleteTweet = `
    DELETE FROM tweet
    WHERE tweet_id = ${tweetId};`;
    await db.run(deleteTweet);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
